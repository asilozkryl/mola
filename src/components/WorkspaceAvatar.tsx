import { useState } from "react";
import "./workspace-avatar.css";

type WorkspaceIdentity = { id: string; name: string; avatarUrl?: string };

export function WorkspaceAvatar({
  workspace,
  size = "medium",
  className = "",
}: {
  workspace: WorkspaceIdentity;
  size?: "small" | "medium" | "large";
  className?: string;
}) {
  const source = `${workspace.id}:${workspace.avatarUrl || ""}`;
  const [failedSource, setFailedSource] = useState<string>();
  const initials = workspace.name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] || "")
    .join("")
    .toLocaleUpperCase("tr-TR");

  return (
    <span
      className={`workspace-avatar workspace-avatar-${size} ${className}`.trim()}
      aria-hidden="true"
    >
      {workspace.avatarUrl && failedSource !== source ? (
        <img
          key={source}
          src={workspace.avatarUrl}
          alt=""
          draggable={false}
          onError={() => setFailedSource(source)}
        />
      ) : (
        initials || "?"
      )}
    </span>
  );
}
