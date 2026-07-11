import { useDepeche } from '../hooks/useDepeche';
import { JoinScreen } from './JoinScreen';
import { Room } from './Room';

export function App() {
  const api = useDepeche();
  return api.phase === 'join'
    ? <JoinScreen onJoin={api.join} busy={api.busy} error={api.micError} />
    : <Room api={api} />;
}
