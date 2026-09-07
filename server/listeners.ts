import type { Server } from 'node:http';

export interface ListenerConfig { port: number; opsPort?: number; host: string; }

export function readListenerConfig(environment: NodeJS.ProcessEnv = process.env): ListenerConfig {
  const parsePort = (name: 'PORT' | 'OPS_PORT', value: string) => {
    const port = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be an integer from 1 to 65535.`);
    return port;
  };
  const port = parsePort('PORT', environment.PORT?.trim() || '3001');
  const opsPort = environment.OPS_PORT?.trim() ? parsePort('OPS_PORT', environment.OPS_PORT.trim()) : undefined;
  if (opsPort === port) throw new Error('OPS_PORT must differ from PORT.');
  return { port, opsPort, host: environment.HOST || '0.0.0.0' };
}

export async function startListeners(runtime: { server: Server; opsServer?: Server; close(): Promise<void> }, config: ListenerConfig) {
  const listen = (server: Server, port: number) => new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, config.host);
  });
  try {
    if (Boolean(runtime.opsServer) !== (config.opsPort !== undefined)) throw new Error('Operations listener configuration does not match the application.');
    if (runtime.opsServer) await listen(runtime.opsServer, config.opsPort!);
    // Do not expose the public health endpoint before operations is available.
    await listen(runtime.server, config.port);
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
