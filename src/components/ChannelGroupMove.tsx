import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { Check, Folder, Hash } from "lucide-react";
import type { SidebarChannelGroup } from "../../shared/sidebar";
import { Modal, Spinner } from "./ui";

export function ChannelGroupMove({
  name,
  channelId,
  groups,
  error,
  onMove,
  onClose,
}: {
  name: string;
  channelId: string;
  groups: SidebarChannelGroup[];
  error: string;
  onMove: (id: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current =
    groups.find((group) => group.channelIds.includes(channelId))?.id || null;
  async function move(id: string | null) {
    if (busy) return;
    setBusy(true);
    const ok = await onMove(id);
    if (mounted.current) {
      setBusy(false);
      if (ok) onClose();
    }
  }
  return (
    <Modal
      title="Kanalı bölüme taşı"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="modal-description">
        <strong>#{name}</strong> için bir bölüm seç. Bu düzen yalnızca sana ait.
      </p>
      <div className="members-modal-list">
        {[{ id: null, name: "Kanallar" }, ...groups].map((group) => (
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            key={group.id || "default"}
            aria-label={`${group.name} bölümüne taşı`}
            disabled={busy || current === group.id}
            onClick={() => void move(group.id)}
          >
            {group.id ? <Folder size={19} /> : <Hash size={19} />}
            <span>
              <strong>{group.name}</strong>
              {current === group.id && <small>Şu an burada</small>}
            </span>
            {current === group.id && <Check size={17} />}
          </Button>
        ))}
      </div>
      {!groups.length && (
        <p className="modal-description">
          İlk bölümünü Kanallar menüsündeki “Bölüm oluştur” ile ekleyebilirsin.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {busy && <Spinner label="Kanal taşınıyor" />}
    </Modal>
  );
}
