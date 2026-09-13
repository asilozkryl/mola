import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Link,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { MemberProfile, User } from "../../shared/types";
import { api } from "../lib/api";
import { ProfilePresence, profileRoleLabel } from "./ProfileIdentity";
import { Avatar, Spinner } from "./ui";
import "./profile-page.css";

interface ProfilePageProps {
  userId: string;
  workspaceId: string;
  currentUserId: string;
  connected: boolean;
  onlineIds: string[];
  initialUser?: User;
  liveUser?: User;
  profileUrl?: string;
  onBack: () => void;
  onEdit: () => void;
  onMessage: (user: User) => void | Promise<void>;
}

export default function ProfilePage({
  userId,
  workspaceId,
  currentUserId,
  connected,
  onlineIds,
  liveUser,
  profileUrl,
  onBack,
  onEdit,
  onMessage,
}: ProfilePageProps) {
  const context = `${workspaceId}:${currentUserId}:${userId}`;
  const currentContext = useRef(context);
  currentContext.current = context;
  const latestLiveUser = useRef(liveUser);
  latestLiveUser.current = liveUser;
  const observedMember = useRef({ context, seen: false });
  if (observedMember.current.context !== context)
    observedMember.current = { context, seen: false };
  const hasLiveMember = liveUser?.id === userId;
  if (hasLiveMember) observedMember.current.seen = true;
  const membershipUnavailable =
    (hasLiveMember && liveUser.suspended) ||
    (observedMember.current.seen && !hasLiveMember);
  const mounted = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    context: string;
    profile?: MemberProfile;
    error?: string;
  }>({ context });
  const [actionError, setActionError] = useState("");
  const [messaging, setMessaging] = useState(false);
  const messagingRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const profile =
    !membershipUnavailable && result.context === context
      ? result.profile
      : undefined;
  const error = membershipUnavailable
    ? "Bu üyenin profili artık bu çalışma alanında görüntülenemiyor."
    : result.context === context
      ? result.error
      : undefined;

  useEffect(() => {
    if (membershipUnavailable)
      setResult({
        context,
        error: "Bu üyenin profili artık bu çalışma alanında görüntülenemiyor.",
      });
  }, [context, membershipUnavailable]);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => setRetry((value) => value + 1);
    window.addEventListener("mola:admin-refresh", refresh);
    return () => {
      mounted.current = false;
      clearTimeout(copyTimer.current);
      window.removeEventListener("mola:admin-refresh", refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setResult({ context });
    setActionError("");
    setCopied(false);
    setMessaging(false);
    messagingRef.current = false;
    clearTimeout(copyTimer.current);
    if (membershipUnavailable) return;
    const liveUserAtRequest = latestLiveUser.current;
    api<MemberProfile>(`/members/${encodeURIComponent(userId)}/profile`, {
      signal: controller.signal,
      headers: {
        "X-Workspace-Id": workspaceId,
        "X-User-Id": currentUserId,
      },
    })
      .then((loaded) => {
        if (!alive || currentContext.current !== context) return;
        if (loaded.user.id !== userId)
          throw new Error("Profil yüklenemedi. Yeniden deneyebilirsin.");
        const currentLiveUser = latestLiveUser.current;
        // A profile fetch can finish after a newer member:updated event. Keep
        // those live display fields while retaining the server's membership data.
        const updatedWhileLoading =
          currentLiveUser !== liveUserAtRequest &&
          currentLiveUser?.id === userId &&
          !currentLiveUser.suspended;
        setResult({
          context,
          profile: updatedWhileLoading
            ? { ...loaded, user: currentLiveUser }
            : loaded,
        });
      })
      .catch((caught) => {
        if (!alive || currentContext.current !== context) return;
        setResult({
          context,
          error:
            caught instanceof Error
              ? caught.message
              : "Profil yüklenemedi. Yeniden deneyebilirsin.",
        });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [userId, workspaceId, currentUserId, retry, membershipUnavailable]);

  // Refresh display fields when a workspace member update arrives. Membership
  // metadata stays tied to the authorized profile response above.
  useEffect(() => {
    if (!liveUser || liveUser.id !== userId) return;
    setResult((current) =>
      current.context === context && current.profile
        ? {
            ...current,
            profile: {
              ...current.profile,
              user: liveUser,
            },
          }
        : current,
    );
  }, [liveUser, context, userId]);

  useEffect(() => {
    if (profile || error) headingRef.current?.focus({ preventScroll: true });
  }, [context, Boolean(profile), Boolean(error)]);

  async function copyLink() {
    setActionError("");
    try {
      await navigator.clipboard.writeText(profileUrl || window.location.href);
      if (!mounted.current || currentContext.current !== context) return;
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      if (mounted.current && currentContext.current === context)
        setActionError(
          "Bağlantı kopyalanamadı. Tarayıcının adres çubuğundan kopyalayabilirsin.",
        );
    }
  }

  async function message() {
    if (!profile?.canMessage || messagingRef.current) return;
    messagingRef.current = true;
    setMessaging(true);
    setActionError("");
    try {
      await onMessage(profile.user);
    } catch (caught) {
      if (mounted.current && currentContext.current === context)
        setActionError(
          caught instanceof Error
            ? caught.message
            : "Sohbet açılamadı. Yeniden deneyebilirsin.",
        );
    } finally {
      if (mounted.current && currentContext.current === context) {
        messagingRef.current = false;
        setMessaging(false);
      }
    }
  }

  const user = profile?.user;
  const isSelf = user?.id === currentUserId;
  const joinedAt = profile?.joinedAt ? new Date(profile.joinedAt) : undefined;
  const joinedLabel =
    joinedAt && !Number.isNaN(joinedAt.getTime())
      ? joinedAt.toLocaleDateString("tr-TR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : undefined;

  return (
    <section className="member-profile-page" aria-label="Üye profili">
      <header className="member-profile-toolbar">
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          className="member-profile-back"
          onClick={onBack}
        >
          <ArrowLeft size={17} aria-hidden="true" /> Sohbete dön
        </Button>
        <span>Üye profili</span>
      </header>
      {!profile && !error && (
        <div className="member-profile-loading">
          <Spinner label="Profil yükleniyor" />
        </div>
      )}
      {error && (
        <div className="member-profile-unavailable">
          <UserRound size={28} aria-hidden="true" />
          <h1 ref={headingRef} tabIndex={-1}>
            Profil görüntülenemiyor
          </h1>
          <p role="alert">{error}</p>
          <Button
            variant="outline"
            size="unset"
            type="button"
            className="secondary-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            <RefreshCw size={15} aria-hidden="true" /> Yeniden dene
          </Button>
        </div>
      )}
      {profile && user && (
        <div className="member-profile-content">
          <div className="member-profile-intro">
            <div className="member-profile-avatar">
              <Avatar
                user={user}
                size="large"
                online={connected && onlineIds.includes(user.id)}
              />
            </div>
            <div className="member-profile-name">
              <h1 ref={headingRef} tabIndex={-1}>
                {user.name}
                {isSelf && <span>Sen</span>}
              </h1>
              {user.jobTitle && <p>{user.jobTitle}</p>}
              <div className="member-profile-presence">
                <ProfilePresence
                  online={onlineIds.includes(user.id)}
                  connected={connected}
                />
                {user.status && (
                  <span className="member-profile-status">{user.status}</span>
                )}
              </div>
            </div>
          </div>
          <div className="member-profile-actions">
            {isSelf ? (
              <Button
                variant="default"
                size="unset"
                type="button"
                className="primary-button"
                onClick={onEdit}
              >
                <Pencil size={15} aria-hidden="true" /> Profili düzenle
              </Button>
            ) : profile.canMessage ? (
              <Button
                variant="default"
                size="unset"
                type="button"
                className="primary-button"
                onClick={() => void message()}
                disabled={messaging}
              >
                {messaging ? (
                  <Spinner label="Sohbet açılıyor" />
                ) : (
                  <>
                    <MessageSquare size={16} aria-hidden="true" /> Mesaj gönder
                  </>
                )}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="unset"
              type="button"
              className="secondary-button member-profile-copy"
              onClick={() => void copyLink()}
            >
              {copied ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Link size={15} aria-hidden="true" />
              )}
              {copied ? "Bağlantı kopyalandı" : "Profil bağlantısını kopyala"}
            </Button>
            <span className="sr-only" role="status">
              {copied ? "Profil bağlantısı kopyalandı." : ""}
            </span>
          </div>
          {actionError && (
            <p className="form-error member-profile-action-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="member-profile-details">
            <section
              className="member-profile-about"
              aria-labelledby="member-profile-about-heading"
            >
              <h2 id="member-profile-about-heading">Hakkında</h2>
              {user.bio ? (
                <p>{user.bio}</p>
              ) : (
                <div className="member-profile-empty-about">
                  <p>
                    {isSelf
                      ? "Kendinden kısaca bahset; ekip arkadaşların seni tanısın."
                      : "Henüz bir tanıtım eklenmemiş."}
                  </p>
                  {isSelf && (
                    <Button
                      variant="unstyled"
                      size="unset"
                      type="button"
                      onClick={onEdit}
                    >
                      Tanıtım ekle
                    </Button>
                  )}
                </div>
              )}
            </section>
            <section
              className="member-profile-information"
              aria-labelledby="member-profile-information-heading"
            >
              <h2 id="member-profile-information-heading">Profil bilgileri</h2>
              <dl>
                <div>
                  <dt>
                    <ShieldCheck size={15} aria-hidden="true" /> Rol
                  </dt>
                  <dd>{profileRoleLabel(user)}</dd>
                </div>
                {user.jobTitle && (
                  <div>
                    <dt>
                      <BriefcaseBusiness size={15} aria-hidden="true" /> Unvan
                    </dt>
                    <dd>{user.jobTitle}</dd>
                  </div>
                )}
                {user.email && (
                  <div>
                    <dt>
                      <Mail size={15} aria-hidden="true" /> E-posta
                    </dt>
                    <dd>
                      <a href={`mailto:${user.email}`}>{user.email}</a>
                    </dd>
                  </div>
                )}
                {user.location && (
                  <div>
                    <dt>
                      <MapPin size={15} aria-hidden="true" /> Konum
                    </dt>
                    <dd>{user.location}</dd>
                  </div>
                )}
                {joinedLabel && (
                  <div>
                    <dt>
                      <CalendarDays size={15} aria-hidden="true" /> Katılma
                      tarihi
                    </dt>
                    <dd>
                      <time dateTime={profile.joinedAt}>{joinedLabel}</time>
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
