import { useEffect, useState, type FormEvent } from 'react';
import { Globe2, LockKeyhole, Search, ShieldCheck, Users } from 'lucide-react';
import type { Channel, ChannelAccess, WorkspaceRole } from '../../shared/types';
import { api } from '../lib/api';
import { Avatar, Modal, Spinner } from './ui';
import './channel-access.css';

export const roleNames: Record<WorkspaceRole, string> = { owner: 'Alan sahibi', admin: 'Yönetici', moderator: 'Moderatör', member: 'Üye', guest: 'Misafir' };

export default function ChannelAccessDialog({ channel, currentUserId, onChanged, onClose }: {
  channel: Channel; currentUserId: string; onChanged: (channel: Channel) => void; onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ChannelAccess>();
  const [visibility, setVisibility] = useState<'public' | 'private'>(channel.visibility || 'public');
  const [selected, setSelected] = useState<string[]>(channel.memberIds || []);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmPublic, setConfirmPublic] = useState(false);
  useEffect(() => {
    let active = true;
    void api<ChannelAccess>(`/channels/${channel.id}/access`).then(value => {
      if (!active) return;
      setSnapshot(value); setVisibility(value.channel.visibility || 'public'); setSelected((value.channel.memberIds || []).filter(id => value.members.some(member => member.id === id)));
    }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [channel.id]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || !snapshot?.canManage) return;
    if (snapshot.channel.visibility === 'private' && visibility === 'public' && !confirmPublic) { setConfirmPublic(true); return; }
    setBusy(true); setError('');
    try {
      const updated = await api<Channel>(`/channels/${channel.id}/access`, { method: 'PATCH', body: JSON.stringify({ visibility, memberIds: selected }) });
      onChanged(updated); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function toggleArchive() {
    if (busy || !snapshot?.canModerate) return;
    setBusy(true); setError('');
    try {
      await api(`/admin/workspace/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify({ archived: !snapshot.channel.archived }) });
      onChanged({ ...snapshot.channel, archived: !snapshot.channel.archived }); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const visibleMembers = snapshot?.members.filter(member => `${member.name} ${member.email}`.toLocaleLowerCase('tr').includes(query.trim().toLocaleLowerCase('tr'))) || [];
  return <Modal title={`${channel.name} · Kanal erişimi`} onClose={() => { if (!busy) onClose(); }}>
    <div className="channel-access">
      {!snapshot && !error && <Spinner label="Kanal erişimi yükleniyor" />}
      {snapshot && <form onSubmit={save}>
        <fieldset className="channel-visibility" disabled={!snapshot.canManage || busy}>
          <legend>Bu kanalı kimler görebilir?</legend>
          {(['public', 'private'] as const).map(value => <label key={value} className={visibility === value ? 'selected' : ''}>
            <input type="radio" name="visibility" value={value} checked={visibility === value} onChange={() => {
              setVisibility(value); setConfirmPublic(false);
              if (value === 'private' && !selected.length) setSelected([currentUserId]);
            }} />
            {value === 'private' ? <LockKeyhole size={20} /> : <Globe2 size={20} />}
            <span><strong>{value === 'private' ? 'Özel kanal' : 'Herkese açık'}</strong><small>{value === 'private' ? 'Yalnızca seçtiğin üyeler ve misafirler.' : 'Ekip üyeleri ve seçtiğin misafirler.'}</small></span>
          </label>)}
        </fieldset>
        <div className="channel-access-heading"><Users size={18} /><h3>{visibility === 'private' ? 'Kanal üyeleri' : 'Kanala atanmış kişiler'}</h3><span>{selected.length}</span></div>
        <p className="channel-access-note">{visibility === 'private' ? 'Yöneticilerin de mesajları okumak veya görüşmeye katılmak için listede olması gerekir.' : 'Misafirler yalnızca atandıkları kanallara erişebilir. Diğer ekip üyeleri bu kanalı zaten görebilir.'}</p>
        {snapshot.members.length > 5 && <label className="channel-member-search"><Search size={17} /><input aria-label="Kanal üyelerinde ara" placeholder="İsim veya e-posta ile ara" value={query} onChange={e => setQuery(e.target.value)} /></label>}
        <div className="channel-member-list" aria-label="Kanal üye seçimi">
          {visibleMembers.map(member => <label key={member.id} className={selected.includes(member.id) ? 'selected' : ''}>
            <input type="checkbox" aria-label={`${member.name} kanala erişebilsin`} checked={selected.includes(member.id)} disabled={!snapshot.canManage || busy} onChange={e => setSelected(previous => e.target.checked ? [...previous, member.id] : previous.filter(id => id !== member.id))} />
            <Avatar user={member} size="small" /><span><strong>{member.name}{member.id === currentUserId ? ' (sen)' : ''}</strong><small>{member.isBot ? 'Ekip botu' : roleNames[member.role]}</small></span>
          </label>)}
          {!visibleMembers.length && <p className="channel-access-note">Bu aramayla eşleşen üye yok.</p>}
        </div>
        {!snapshot.canManage && <p className="channel-access-note"><ShieldCheck size={15} /> Kanal erişimini alan sahibi ve yöneticiler düzenleyebilir.</p>}
        {confirmPublic && <p role="alert" className="channel-public-confirm">Bu kanaldaki geçmiş mesajlar ve dosyalar tüm ekip üyelerine açılacak. Devam etmek için tekrar kaydet.</p>}
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="channel-access-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Kapat</button>
          {snapshot.canManage && <button className="primary-button" disabled={busy || (visibility === 'private' && !selected.length)}>{busy ? <Spinner label="Kaydediliyor" /> : confirmPublic ? 'Herkese aç ve kaydet' : 'Erişimi kaydet'}</button>}
        </div>
        {snapshot.canModerate && <div className="channel-access-archive"><p>{snapshot.channel.archived ? 'Kanalı yeniden açarak mesajlaşmaya devam edebilirsiniz.' : 'Arşivleme mesajları korur ve devam eden görüşmeyi kapatır.'}</p><button className="secondary-button" type="button" disabled={busy} onClick={() => void toggleArchive()}>{snapshot.channel.archived ? 'Kanalı arşivden çıkar' : 'Kanalı arşivle'}</button></div>}
      </form>}
      {!snapshot && error && <p role="alert" className="form-error">{error}</p>}
    </div>
  </Modal>;
}
