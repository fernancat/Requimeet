import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getHostToken } from '../lib/auth';
import RequirementsPanel from '../features/requirements/RequirementsPanel';
import QuestionsPanel from '../features/workspace/QuestionsPanel';
import ArtifactsPanel from '../features/workspace/ArtifactsPanel';
export default function ReviewPage() {
 const { code = '' } = useParams();
 const token = getHostToken() ?? '';
 const [tab, setTab] = useState('requirements');
 return <div className="review-page"><header className="nav-bar"><h1>Levantamiento · {code}</h1><Link to="/dashboard">Mis reuniones</Link></header>
 <nav className="review-tabs" aria-label="Revisión del levantamiento">{[['requirements','Requerimientos'],['questions','Preguntas'],['entities','Entidades']].map(([id,label]) => <button key={id} aria-pressed={tab === id} className={tab === id ? '' : 'secondary'} onClick={() => setTab(id)}>{label}</button>)}</nav>
 <main className="review-content"><div hidden={tab !== 'requirements'}><RequirementsPanel code={code} token={token} canEdit refreshVersion={0} /></div><div hidden={tab !== 'questions'}><QuestionsPanel code={code} token={token} canEdit /></div><div hidden={tab !== 'entities'}><ArtifactsPanel code={code} token={token} canEdit /></div></main></div>;
}
