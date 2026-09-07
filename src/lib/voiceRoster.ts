import type { Socket } from "socket.io-client";
import type { VoiceChannelRoster, VoiceRoster } from "../../shared/types";

/** Install listeners before requesting, so a fast server response cannot be missed. */
export function subscribeVoiceRoster(
  socket: Socket,
  workspaceId: string,
  onSnapshot: (channels: VoiceChannelRoster[]) => void,
) {
  const receive = (payload: VoiceRoster) => {
    if (payload?.workspaceId === workspaceId && Array.isArray(payload.channels))
      onSnapshot(payload.channels);
  };
  const refresh = () => socket.emit("voice:roster:request");
  const clear = () => onSnapshot([]);
  socket.on("voice:roster", receive);
  socket.on("connect", refresh);
  socket.on("disconnect", clear);
  if (socket.connected) refresh();
  return () => {
    socket.off("voice:roster", receive);
    socket.off("connect", refresh);
    socket.off("disconnect", clear);
  };
}
