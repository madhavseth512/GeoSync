import { io } from 'socket.io-client';
import { API_BASE_URL } from './config';
import { getToken } from './auth';

// Creates a Socket.IO connection authenticated with the stored JWT — same
// handshake the web client uses (io({ auth: { token } })). We force the
// websocket transport because React Native's polling fallback can be flaky.
export async function createSocket() {
  const token = await getToken();
  return io(API_BASE_URL, {
    auth: { token },
    transports: ['websocket'],
  });
}
