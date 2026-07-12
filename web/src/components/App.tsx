import { useDepeche } from '../hooks/useDepeche';
import { Lobby } from './Lobby';
import { Room } from './Room';

export function App() {
  const api = useDepeche();
  return api.phase === 'lobby' ? <Lobby api={api} /> : <Room api={api} />;
}
