import React from "react";
import { VaultConsole, VaultConsoleProps } from "./VaultConsole";

export interface ApiVaultModalProps extends Omit<VaultConsoleProps, "isModal"> {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: "broker" | "cloud" | "ai" | "feeds";
}

export const ApiVaultModal: React.FC<ApiVaultModalProps> = ({
  isOpen,
  onClose,
  defaultTab,
  ...props
}) => {
  return (
    <VaultConsole
      isModal={true}
      isOpen={isOpen}
      onClose={onClose}
      initialTab={defaultTab}
      {...props}
    />
  );
};

export default ApiVaultModal;
