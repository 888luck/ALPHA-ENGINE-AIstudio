import fs from "fs";
import path from "path";

interface SyncResult {
  success: boolean;
  message: string;
  commitSha?: string;
  url?: string;
}

/**
 * Recursively scans directory paths and returns list of relative file paths.
 */
function getFilesRecursive(dir: string, baseDir: string = dir): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      const relative = path.relative(baseDir, fullPath);

      // Skip common development or dynamic ignore directories
      if (
        file === "node_modules" ||
        file === ".git" ||
        file === "dist" ||
        file === ".next" ||
        file === ".dev" ||
        file === "remote_vm_setup.sh" ||
        relative.startsWith("node_modules/") ||
        relative.startsWith("dist/") ||
        relative.startsWith(".git")
      ) {
        continue;
      }

      if (stat.isDirectory()) {
        results = results.concat(getFilesRecursive(fullPath, baseDir));
      } else {
        results.push(relative);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
  }
  return results;
}

/**
 * Main Git engine syncing local filesystem to GitHub directly via REST API.
 */
export async function pushToGithub(
  token: string,
  repoPath: string, // e.g., "888luck/ALPHA-ENGINE-AIstudio"
  branchName: string = "main"
): Promise<SyncResult> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "Alpha-Engine-Sync-Engine",
  };

  const cleanRepo = repoPath.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  const baseUrl = `https://api.github.com/repos/${cleanRepo}`;

  try {
    console.log(`[GITHUB SYNC] Initiating sync sequence for repo: ${cleanRepo} on branch: ${branchName}`);

    // 1. Fetch current commit of target branch (fallback to master if main fails)
    let branchRefUrl = `${baseUrl}/git/ref/heads/${branchName}`;
    let refResponse = await fetch(branchRefUrl, { headers });

    if (refResponse.status === 404 && branchName === "main") {
      // Try master as fallback
      branchName = "master";
      branchRefUrl = `${baseUrl}/git/ref/heads/master`;
      refResponse = await fetch(branchRefUrl, { headers });
    }

    let parentCommitSha = "";
    let baseTreeSha = "";

    if (refResponse.status === 200) {
      const refData: any = await refResponse.json();
      parentCommitSha = refData.object.sha;

      // Get the tree SHA associated with the latest commit
      const commitResponse = await fetch(`${baseUrl}/commits/${parentCommitSha}`, { headers });
      if (commitResponse.ok) {
        const commitData: any = await commitResponse.json();
        baseTreeSha = commitData.commit.tree.sha;
      }
    } else if (refResponse.status === 404) {
      // Repository might be empty (has no branches yet).
      // We will try to create a standard commit directly if the repository is initialized or fallback.
      return {
        success: false,
        message: `Branch heads/${branchName} not found. Please ensure the repository is not empty and has a default branch (like 'main' or 'master').`,
      };
    } else {
      const errText = await refResponse.text();
      return {
        success: false,
        message: `GitHub Authenticator denied authorization. (${refResponse.status}: ${errText})`,
      };
    }

    // 2. Scan and find all files to upload
    const rootPath = process.cwd();
    const relativePaths = getFilesRecursive(rootPath);
    console.log(`[GITHUB SYNC] Scanning completed. Packing ${relativePaths.length} files for commit.`);

    // 3. Post blobs sequentially to prevent limits and preserve structure
    const treeItems: any[] = [];
    for (const relPath of relativePaths) {
      const absolute = path.join(rootPath, relPath);
      let content = "";
      try {
        content = fs.readFileSync(absolute, "utf-8");
      } catch (err) {
        // Skip binary or unreadable files securely
        continue;
      }

      // Skip completely empty files
      if (!content && relPath !== ".gitignore") continue;

      // Post standard blob creation
      const blobResponse = await fetch(`${baseUrl}/git/blobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: Buffer.from(content).toString("base64"),
          encoding: "base64",
        }),
      });

      if (!blobResponse.ok) {
        const errText = await blobResponse.text();
        console.error(`Failed to upload blob for ${relPath}:`, errText);
        continue;
      }

      const blobData: any = await blobResponse.json();
      
      // Use standard github modes. File mode must be 100644 for general files, or 100755 for executables/scripts
      const isScript = relPath.endsWith(".sh") || relPath === "main.py";
      const mode = isScript ? "100755" : "100644";

      treeItems.push({
        path: relPath,
        mode,
        type: "blob",
        sha: blobData.sha,
      });
    }

    if (treeItems.length === 0) {
      return {
        success: false,
        message: "No syncable source files were identified in the local workspace.",
      };
    }

    // 4. Create Git tree
    const treePayload: any = {
      tree: treeItems,
    };
    if (baseTreeSha) {
      treePayload.base_tree = baseTreeSha;
    }

    const treeResponse = await fetch(`${baseUrl}/git/trees`, {
      method: "POST",
      headers,
      body: JSON.stringify(treePayload),
    });

    if (!treeResponse.ok) {
      const errText = await treeResponse.text();
      return {
        success: false,
        message: `Failed to construct remote filesystem tree. (${errText})`,
      };
    }

    const newTreeData: any = await treeResponse.json();
    const newTreeSha = newTreeData.sha;

    // 5. Create commit
    const commitPayload: any = {
      message: `⚡ [Alpha Engine Sync] Production-ready update from AI Studio (Build ${new Date().toLocaleDateString()})`,
      tree: newTreeSha,
    };
    if (parentCommitSha) {
      commitPayload.parents = [parentCommitSha];
    }

    const newCommitResponse = await fetch(`${baseUrl}/git/commits`, {
      method: "POST",
      headers,
      body: JSON.stringify(commitPayload),
    });

    if (!newCommitResponse.ok) {
      const errText = await newCommitResponse.text();
      return {
        success: false,
        message: `Failed to register release commit. (${errText})`,
      };
    }

    const newCommitData: any = await newCommitResponse.json();
    const newCommitSha = newCommitData.sha;

    // 6. Update reference
    const updateRefResponse = await fetch(`${baseUrl}/git/refs/heads/${branchName}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        sha: newCommitSha,
        force: true,
      }),
    });

    if (!updateRefResponse.ok) {
      const errText = await updateRefResponse.text();
      return {
        success: false,
        message: `Failed to finalize target branch reference pointer. (${errText})`,
      };
    }

    return {
      success: true,
      message: `Perfect! Synced ${treeItems.length} workspace files flawlessly.`,
      commitSha: newCommitSha,
      url: `https://github.com/${cleanRepo}/commit/${newCommitSha}`,
    };
  } catch (error: any) {
    console.error("[GITHUB SYNC] Fatal exception occurred:", error);
    return {
      success: false,
      message: `Fatal synchronization breakdown: ${error.message || error}`,
    };
  }
}
