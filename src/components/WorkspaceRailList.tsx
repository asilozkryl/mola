import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ListOrdered } from "lucide-react";
import type { WorkspaceMembership } from "../../shared/types";
import { Button } from "./ui/button";
import { ContextMenu, type ContextMenuPosition } from "./ContextMenu";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import "./workspace-rail-order.css";

export function WorkspaceRailList({
  userId,
  workspaces,
  currentId,
  busy,
  canReorder,
  error,
  onSelect,
  onReorder,
  onManage,
}: {
  userId: string;
  workspaces: WorkspaceMembership[];
  currentId: string;
  busy: boolean;
  canReorder: boolean;
  error: string;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => Promise<boolean>;
  onManage: () => void;
}) {
  const instructions = useId();
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [menu, setMenu] = useState<{
    id: string;
    position: ContextMenuPosition;
    anchor: HTMLElement;
  } | null>(null);
  const drag = useRef<{ id: string; userId: string } | null>(null);
  const suppressClickUntil = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const end = () => {
    if (drag.current) suppressClickUntil.current = Date.now() + 300;
    drag.current = null;
    setDragging(null);
    setDrop(null);
  };
  useEffect(() => {
    end();
    setMenu(null);
  }, [userId]);
  const move = (id: string, direction: number) => {
    const ids = workspaces.map((item) => item.id),
      index = ids.indexOf(id),
      next = index + direction;
    if (!canReorder || index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void onReorder(ids);
  };
  const selected = menu && workspaces.find((item) => item.id === menu.id);
  const index = selected
    ? workspaces.findIndex((item) => item.id === selected.id)
    : -1;
  return (
    <>
      <p className="visually-hidden" id={instructions}>
        Sürükleyerek sırala. Alt ve yukarı veya aşağı ok tuşlarıyla taşı. Sağ
        tıkla veya Shift ve F10 ile sıralama menüsünü aç.
      </p>
      <div
        className="rail-workspaces"
        ref={list}
        aria-label="Çalışma alanı sırası"
      >
        {workspaces.map((workspace) => (
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            key={workspace.id}
            data-workspace-id={workspace.id}
            className={`workspace-button ${workspace.id === currentId ? "active" : ""} ${dragging === workspace.id ? "workspace-dragging" : ""} ${drop?.id === workspace.id ? (drop.after ? "workspace-drop-after" : "workspace-drop-before") : ""}`}
            title={`${workspace.name} · Sürükleyerek sırala`}
            aria-label={`${workspace.name} alanına geç`}
            aria-describedby={instructions}
            aria-current={workspace.id === currentId ? "true" : undefined}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Shift+F10"
            disabled={
              busy ||
              Boolean(workspace.membershipSuspended || workspace.suspended)
            }
            draggable={canReorder && !busy && workspaces.length > 1}
            onClick={(event) => {
              if (Date.now() < suppressClickUntil.current) {
                event.preventDefault();
                return;
              }
              onSelect(workspace.id);
            }}
            onKeyDown={(event) => {
              if (
                event.altKey &&
                ["ArrowUp", "ArrowDown"].includes(event.key)
              ) {
                event.preventDefault();
                move(workspace.id, event.key === "ArrowUp" ? -1 : 1);
              } else if (
                (event.shiftKey && event.key === "F10") ||
                event.key === "ContextMenu"
              ) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({
                  id: workspace.id,
                  anchor: event.currentTarget,
                  position: { x: rect.right + 6, y: rect.top },
                });
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({
                id: workspace.id,
                anchor: event.currentTarget,
                position: { x: event.clientX, y: event.clientY },
              });
            }}
            onDragStart={(event) => {
              if (!canReorder || busy) {
                event.preventDefault();
                return;
              }
              drag.current = { id: workspace.id, userId };
              setDragging(workspace.id);
              setMenu(null);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", workspace.id);
            }}
            onDragEnd={end}
            onDragOver={(event) => {
              if (
                !canReorder ||
                drag.current?.userId !== userId ||
                drag.current.id === workspace.id
              )
                return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              setDrop({
                id: workspace.id,
                after: event.clientY > rect.top + rect.height / 2,
              });
              const container = list.current,
                bounds = container?.getBoundingClientRect();
              if (container && bounds) {
                if (event.clientY < bounds.top + 28) container.scrollTop -= 12;
                else if (event.clientY > bounds.bottom - 28)
                  container.scrollTop += 12;
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (
                canReorder &&
                drag.current?.userId === userId &&
                drag.current.id !== workspace.id
              ) {
                const id = drag.current.id,
                  ids = workspaces
                    .map((item) => item.id)
                    .filter((item) => item !== id),
                  at = ids.indexOf(workspace.id);
                const rect = event.currentTarget.getBoundingClientRect();
                if (at >= 0 && workspaces.some((item) => item.id === id)) {
                  ids.splice(
                    at + (event.clientY > rect.top + rect.height / 2 ? 1 : 0),
                    0,
                    id,
                  );
                  void onReorder(ids);
                }
              }
              end();
            }}
          >
            <WorkspaceAvatar workspace={workspace} size="medium" />
          </Button>
        ))}
      </div>
      {error && (
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          className="rail-order-error"
          onClick={onManage}
          aria-label={`Sıralama: ${error}`}
          title={error}
        >
          <ListOrdered size={17} />
        </Button>
      )}
      {menu && selected && (
        <ContextMenu
          label={`${selected.name} sıralama menüsü`}
          position={menu.position}
          returnFocus={menu.anchor}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Yukarı taşı",
              icon: <ArrowUp size={16} />,
              disabled: !canReorder || index <= 0,
              onSelect: () => move(selected.id, -1),
            },
            {
              label: "Aşağı taşı",
              icon: <ArrowDown size={16} />,
              disabled: !canReorder || index >= workspaces.length - 1,
              onSelect: () => move(selected.id, 1),
            },
            {
              label: "Sırayı düzenle",
              icon: <ListOrdered size={16} />,
              separatorBefore: true,
              onSelect: onManage,
            },
          ]}
        />
      )}
    </>
  );
}
