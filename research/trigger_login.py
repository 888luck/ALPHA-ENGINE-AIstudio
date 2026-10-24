import subprocess
import time
import os

env = dict(os.environ, DISPLAY=":1")

def run(cmd):
    print(f"RUN: {cmd}")
    subprocess.run(cmd, shell=True, env=env)

# Focus password field
run("xdotool mousemove 600 415 click 1")
time.sleep(1)

# Select all existing text just in case and backspace
run("xdotool key ctrl+a BackSpace")
time.sleep(0.5)

# Load password directly without bash interpolation
pw = None
with open("/opt/alpha-engine/.env", "r") as f:
    for line in f:
        if line.startswith("IBKR_PAPER_PASSWORD="):
            pw = line.split("=", 1)[1].strip().strip("'").strip('"')

if not pw:
    print("ERROR: No password found!")
    exit(1)

print(f"Password length: {len(pw)}")

# Type password with delay
# We can use xdotool type --delay 80 --
subprocess.run(["xdotool", "type", "--delay", "80", "--", pw], env=env)
time.sleep(1)

# Click Paper Log In button at (660, 485)
run("xdotool mousemove 660 485 click 1")
print("Clicked login button.")
time.sleep(5)
run("import -window root /tmp/login_result.png")
print("Screenshot captured to /tmp/login_result.png")
