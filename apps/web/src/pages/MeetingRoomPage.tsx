/** Placeholder de la sala de videollamada: se implementa en feat/08. */
export default function MeetingRoomPage({ code }: { code: string }) {
  return (
    <div className="page">
      <div className="card">
        <h2>Sala {code}</h2>
        <p className="status-banner">sala (feat/08)</p>
      </div>
    </div>
  );
}
