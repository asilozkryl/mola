import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Globe2, LockKeyhole, Search, ShieldCheck, Users } from "lucide-react";
import type {
  Channel,
  ChannelAccess,
  User,
  WorkspaceRole,
} from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { Avatar, Modal, Spinner } from "./ui";
import "./channel-access.css";

export const roleNames: Record<WorkspaceRole, string> = {
  owner: "Alan sahibi",
  admin: "Yönetici",
  moderator: "Moderatör",
  member: "Üye",
  guest: "Misafir",
};

export default function ChannelAccessDialog({
  channel,
  currentUserId,
  onChanged,
  onClose,
}: {
  channel: Channel;
  currentUserId: string;
  onChanged: (channel: Channel) => void;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ChannelAccess>();
  const [visibility, setVisibility] = useState<"public" | "private">(
    channel.visibility || "public",
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [accessLost, setAccessLost] = useState(false);
  const [confirmation, setConfirmation] = useState<"public" | "self" | null>(
    null,
  );
  const generation = useRef(0);
  const operation = useRef(false);

  useEffect(() => {
    const version = ++generation.current;
    setSnapshot(undefined);
    setError("");
    setAccessLost(false);
    setConfirmation(null);
    setQuery("");
    setBusy(false);
    operation.current = false;
    void api<ChannelAccess>(`/channels/${channel.id}/access`)
      .then((value) => {
        if (version !== generation.current) return;
        setSnapshot(value);
        setVisibility(value.channel.visibility || "public");
        setSelected(
          (value.channel.memberIds || []).filter((id) =>
            value.members.some((member) => member.id === id),
          ),
        );
      })
      .catch((e) => {
        if (version === generation.current) setError((e as Error).message);
      });
    return () => {
      generation.current++;
    };
  }, [channel.id, reload]);

  const members = snapshot?.members || [];
  const initialIds = (snapshot?.channel.memberIds || []).filter((id) =>
    members.some((member) => member.id === id),
  );
  const added = selected.filter((id) => !initialIds.includes(id));
  const removed = initialIds.filter((id) => !selected.includes(id));
  const dirty = Boolean(
    snapshot &&
    (visibility !== (snapshot.channel.visibility || "public") ||
      added.length ||
      removed.length),
  );
  const canEdit = Boolean(snapshot?.canManage && !busy && !accessLost);
  const currentlyHasAccess =
    initialIds.includes(currentUserId) ||
    (snapshot?.channel.visibility !== "private" &&
      members.some(
        (member) => member.id === currentUserId && member.role !== "guest",
      ));
  const isAutomatic = (member: User) =>
    visibility === "public" && member.role !== "guest";
  const accessCount = members.filter(
    (member) => isAutomatic(member) || selected.includes(member.id),
  ).length;
  const normalizedQuery = query.trim().toLocaleLowerCase("tr");
  const matchesQuery = (member: User) =>
    `${member.name} ${member.email}`
      .toLocaleLowerCase("tr")
      .includes(normalizedQuery);
  const groups =
    visibility === "private"
      ? [
          {
            title: "Bu kanalda",
            members: members.filter((member) => initialIds.includes(member.id)),
          },
          {
            title: "Çalışma alanından ekle",
            members: members.filter(
              (member) => !initialIds.includes(member.id),
            ),
          },
        ]
      : [
          {
            title: "Çalışma alanı üyeleri",
            members: members.filter((member) => member.role !== "guest"),
          },
          {
            title: "Misafirler ve botlar",
            members: members.filter((member) => member.role === "guest"),
          },
        ];

  function clearConfirmation() {
    setConfirmation(null);
    setError("");
  }
  function fail(e: unknown) {
    setError((e as Error).message);
    if (e instanceof ApiError && [401, 403, 404].includes(e.status))
      setAccessLost(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      operation.current ||
      !canEdit ||
      !snapshot ||
      !dirty ||
      (visibility === "private" && !selected.length)
    )
      return;
    if (
      snapshot.channel.visibility === "private" &&
      visibility === "public" &&
      confirmation !== "public"
    ) {
      setConfirmation("public");
      return;
    }
    if (
      visibility === "private" &&
      currentlyHasAccess &&
      !selected.includes(currentUserId) &&
      confirmation !== "self"
    ) {
      setConfirmation("self");
      return;
    }
    const version = generation.current;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Channel>(`/channels/${channel.id}/access`, {
        method: "PATCH",
        body: JSON.stringify({ visibility, memberIds: selected }),
      });
      if (version !== generation.current) return;
      onChanged(updated);
      onClose();
    } catch (e) {
      if (version === generation.current) fail(e);
    } finally {
      if (version === generation.current) {
        operation.current = false;
        setBusy(false);
      }
    }
  }
  async function toggleArchive() {
    if (operation.current || busy || accessLost || !snapshot?.canModerate)
      return;
    const version = generation.current;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/workspace/channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: !snapshot.channel.archived }),
      });
      if (version !== generation.current) return;
      onChanged({ ...snapshot.channel, archived: !snapshot.channel.archived });
      onClose();
    } catch (e) {
      if (version === generation.current) fail(e);
    } finally {
      if (version === generation.current) {
        operation.current = false;
        setBusy(false);
      }
    }
  }

  function memberRow(member: User) {
    const automatic = isAutomatic(member);
    const checked = automatic || selected.includes(member.id);
    const changing =
      !automatic && (added.includes(member.id) || removed.includes(member.id));
    const status = automatic
      ? "Alan üyesi"
      : added.includes(member.id)
        ? "Eklenecek"
        : removed.includes(member.id)
          ? "Kaldırılacak"
          : checked
            ? "Kanala üye"
            : "Kanala ekle";
    return (
      <label
        key={member.id}
        className={`channel-member-row${checked ? " selected" : ""}${automatic ? " automatic" : ""}${changing ? " changing" : ""}`}
      >
        <input
          type="checkbox"
          aria-label={`${member.name} kanala erişebilsin`}
          checked={checked}
          disabled={!canEdit || automatic}
          onChange={(e) => {
            clearConfirmation();
            setSelected((previous) =>
              e.target.checked
                ? [...new Set([...previous, member.id])]
                : previous.filter((id) => id !== member.id),
            );
          }}
        />
        <Avatar user={member} size="small" />
        <span className="channel-member-person">
          <strong title={member.name}>
            {member.name}
            {member.id === currentUserId ? " (sen)" : ""}
          </strong>
          <small title={member.email}>
            {member.isBot ? "Ekip botu" : roleNames[member.role]} ·{" "}
            {member.email}
          </small>
        </span>
        <span
          className={`channel-member-state${removed.includes(member.id) && !automatic ? " removing" : ""}`}
        >
          {status}
        </span>
      </label>
    );
  }

  return (
    <Modal
      title={`${channel.name} · Kanal erişimi`}
      onClose={() => {
        if (!operation.current) onClose();
      }}
    >
      <div className="channel-access" aria-busy={busy}>
        {!snapshot && !error && <Spinner label="Kanal erişimi yükleniyor" />}
        {snapshot && (
          <form onSubmit={save}>
            <p className="channel-access-intro">
              Bu kanala çalışma alanındaki kişileri ekleyebilirsin. Çalışma
              alanına davet etmek, özel kanallara erişim vermez.
            </p>
            <fieldset className="channel-visibility" disabled={!canEdit}>
              <legend>Bu kanalı kimler görebilir?</legend>
              {(["public", "private"] as const).map((value) => (
                <label
                  key={value}
                  className={visibility === value ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={value}
                    checked={visibility === value}
                    onChange={() => {
                      setVisibility(value);
                      clearConfirmation();
                      if (value === "private" && !selected.length)
                        setSelected([currentUserId]);
                    }}
                  />
                  {value === "private" ? (
                    <LockKeyhole size={18} />
                  ) : (
                    <Globe2 size={18} />
                  )}
                  <span>
                    <strong>
                      {value === "private" ? "Özel kanal" : "Herkese açık"}
                    </strong>
                    <small>
                      {value === "private"
                        ? "Yalnızca kanala eklenen kişiler."
                        : "Alan üyeleri ve seçilen misafirler."}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="channel-access-heading">
              <Users size={17} />
              <h3>
                {visibility === "private"
                  ? "Kanal üyeleri"
                  : "Kanala erişen kişiler"}
              </h3>
              <span aria-label={`${accessCount} kişi erişebilir`}>
                {accessCount} kişi
              </span>
            </div>
            <p className="channel-access-note">
              {visibility === "private"
                ? "Yalnızca seçili kişiler mesajları görebilir ve görüşmeye katılabilir. Yöneticilerin de kanala üye olması gerekir."
                : "Alan üyeleri bu kanala otomatik erişir. Misafirleri ayrıca seçebilirsin; erişimi yalnızca seçtiğin kişilerle sınırlamak için özel kanal kullan."}
            </p>
            <label className="channel-member-search">
              <Search size={16} />
              <Input
                unstyled
                type="search"
                aria-label="Kanal üyelerinde ara"
                placeholder="İsim veya e-posta ile ara"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="channel-member-list" aria-label="Kanal üye seçimi">
              {groups.map((group) => {
                const visible = group.members.filter(matchesQuery);
                if (!visible.length) return null;
                return (
                  <section
                    className="channel-member-group"
                    key={group.title}
                    aria-label={group.title}
                  >
                    <h4>
                      {group.title}
                      <span>{group.members.length}</span>
                    </h4>
                    {visible.map(memberRow)}
                  </section>
                );
              })}
              {!members.some(matchesQuery) && (
                <p className="channel-access-empty">
                  {normalizedQuery
                    ? "Bu aramayla eşleşen kişi yok. Başka bir isim veya e-posta dene."
                    : "Eklenecek kişi yok. Önce çalışma alanına kişi davet et."}
                </p>
              )}
            </div>
            <p
              className="channel-access-changes"
              role="status"
              aria-live="polite"
            >
              {dirty ? (
                <>
                  {added.length > 0 && (
                    <span>{added.length} kişi eklenecek</span>
                  )}
                  {removed.length > 0 && (
                    <span>
                      {removed.length} kişinin kanal üyeliği kaldırılacak
                    </span>
                  )}
                  {visibility !== (snapshot.channel.visibility || "public") && (
                    <span>
                      Kanal {visibility === "private" ? "özel" : "herkese açık"}{" "}
                      olacak
                    </span>
                  )}
                </>
              ) : (
                "Kanal üyeliği, çalışma alanı üyeliğinden ayrıdır."
              )}
            </p>
            {visibility === "private" && !selected.length && (
              <p className="channel-access-note">
                Özel kanalda en az bir kişi kalmalı.
              </p>
            )}
            {!snapshot.canManage && (
              <p className="channel-access-note">
                <ShieldCheck size={15} /> Kanal üyelerini alan sahibi ve
                yöneticiler düzenleyebilir.
              </p>
            )}
            {confirmation === "public" && (
              <p role="alert" className="channel-public-confirm">
                Bu kanaldaki geçmiş mesajlar ve dosyalar tüm alan üyelerine
                açılacak. Devam etmek için tekrar kaydet.
              </p>
            )}
            {confirmation === "self" && (
              <p role="alert" className="channel-public-confirm">
                Kendi kanal üyeliğini kaldırıyorsun. Kaydedince bu kanal,
                mesajları ve görüşmeleri senin için kapanacak. Çalışma alanı
                üyeliğin devam eder.
              </p>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {accessLost && (
              <Button
                variant="outline"
                size="unset"
                className="secondary-button"
                type="button"
                onClick={() => setReload((value) => value + 1)}
              >
                Erişimi yeniden kontrol et
              </Button>
            )}
            <div className="channel-access-actions">
              <Button
                variant="outline"
                size="unset"
                className="secondary-button"
                type="button"
                onClick={onClose}
                disabled={busy}
              >
                Kapat
              </Button>
              {snapshot.canManage && (
                <Button
                  variant="default"
                  size="unset"
                  type="submit"
                  className="primary-button"
                  disabled={
                    !canEdit ||
                    !dirty ||
                    (visibility === "private" && !selected.length)
                  }
                >
                  {busy ? (
                    <Spinner label="Kaydediliyor" />
                  ) : confirmation === "public" ? (
                    "Herkese aç ve kaydet"
                  ) : confirmation === "self" ? (
                    "Erişimimi kaldır ve kaydet"
                  ) : (
                    "Erişimi kaydet"
                  )}
                </Button>
              )}
            </div>
            {snapshot.canModerate && (
              <details className="channel-access-archive">
                <summary>
                  Kanalı {snapshot.channel.archived ? "yeniden aç" : "arşivle"}
                </summary>
                <p>
                  {snapshot.channel.archived
                    ? "Kanalı yeniden açarak mesajlaşmaya devam edebilirsiniz."
                    : "Arşivleme mesajları korur ve devam eden görüşmeyi kapatır."}
                </p>
                {dirty && (
                  <p>
                    Üyelik değişikliklerini önce kaydet veya bu pencereyi
                    kapatarak vazgeç.
                  </p>
                )}
                <Button
                  variant="outline"
                  size="unset"
                  className="secondary-button"
                  type="button"
                  disabled={busy || accessLost || dirty}
                  onClick={() => void toggleArchive()}
                >
                  {snapshot.channel.archived
                    ? "Kanalı arşivden çıkar"
                    : "Kanalı arşivle"}
                </Button>
              </details>
            )}
          </form>
        )}
        {!snapshot && error && (
          <div className="channel-access-load-error">
            <p role="alert" className="form-error">
              {error}
            </p>
            <Button
              variant="outline"
              size="unset"
              className="secondary-button"
              type="button"
              onClick={() => setReload((value) => value + 1)}
            >
              Yeniden dene
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
