import { JoinRequestsState } from './useJoinRequests';

/** Cola de admision del anfitrion. La autorizacion real la fuerza el servidor. */
export default function JoinRequestsPanel({
  pending,
  rowStates,
  decide,
}: JoinRequestsState) {
  if (pending.length === 0) {
    return <p className="info-text">No hay solicitudes pendientes.</p>;
  }
  return (
    <ul className="join-requests">
      {pending.map((r) => {
        const state = rowStates[r.id];
        return (
          <li key={r.id} className={state === 'working' ? 'working' : ''}>
            <span>{r.displayName}</span>
            <span className="join-actions">
              {state === 'error' && <span className="error-text">Error</span>}
              <button
                disabled={state === 'working'}
                onClick={() => void decide(r.id, 'accept')}
              >
                Admitir
              </button>
              <button
                className="secondary"
                disabled={state === 'working'}
                onClick={() => void decide(r.id, 'reject')}
              >
                Rechazar
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
