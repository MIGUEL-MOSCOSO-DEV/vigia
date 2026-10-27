import React, { useState, useEffect } from 'react';
import { Plus, Play, Pause, ExternalLink, ChevronRight, Radio } from 'lucide-react';
import { api } from './api.js';
import {
  Session,
  Brand,
  Identity,
  Button,
  Field,
  Modal,
  Notice,
  Empty,
  useTask,
  useData,
  dateLabel,
  LinkModal,
} from './ui.jsx';
const incidentLabels = {
  investigating: 'Investigando',
  identified: 'Identificado',
  monitoring: 'En observación',
  resolved: 'Resuelto',
};
export default function App() {
  const token = window.location.pathname.split('/status/')[1];
  if (token) return <PublicStatus token={token} />;
  return <Session>{(user, onUser) => <Console user={user} onUser={onUser} />}</Session>;
}
function Console({ user, onUser }) {
  const { data, error, reload } = useData('/workspace/state');
  const [tab, setTab] = useState('monitors');
  const [adding, setAdding] = useState(false);
  const [incident, setIncident] = useState(null);
  const [detail, setDetail] = useState(null);
  const [link, setLink] = useState('');
  const task = useTask();
  useEffect(() => {
    const timer = setInterval(() => reload().catch(() => {}), 30000);
    return () => clearInterval(timer);
  }, [reload]);
  return (
    <div className="console">
      <header className="console-head">
        <Brand />
        <span className="system-label">
          <i /> OPERATIONS CONSOLE
        </span>
        <Identity user={user} onUser={onUser} />
      </header>
      <nav className="console-nav">
        <div className="tabs">
          <button className={tab === 'monitors' ? 'active' : ''} onClick={() => setTab('monitors')}>
            01 / Monitores
          </button>
          <button
            className={tab === 'incidents' ? 'active' : ''}
            onClick={() => setTab('incidents')}
          >
            02 / Incidentes
          </button>
        </div>
        <button
          className="text-control"
          onClick={() =>
            task.perform(async () => {
              const result = await api('/workspace/status-link', { method: 'POST', body: {} });
              setLink(result.url);
            })
          }
        >
          Publicar página de estado <ExternalLink size={13} />
        </button>
      </nav>
      <main>
        <Notice error={error || task.error} />
        <section className="console-title">
          <div>
            <span className="eyebrow">SEÑAL / DISPONIBILIDAD / RESPUESTA</span>
            <h1>{tab === 'monitors' ? 'No pierdas la señal.' : 'Cuando algo cambia.'}</h1>
            <p>
              {tab === 'monitors'
                ? 'Cada servicio, una señal. Cada comprobación, un registro.'
                : 'Comunica el estado de tus servicios con contexto.'}
            </p>
          </div>
          <Button onClick={() => (tab === 'monitors' ? setAdding(true) : setIncident({}))}>
            <Plus size={15} />
            {tab === 'monitors' ? 'Añadir monitor' : 'Registrar incidente'}
          </Button>
        </section>
        <div className="readouts">
          <span>
            MONITORES <b>{data?.monitors.length || 0}</b>
          </span>
          <span className="up">
            EN LÍNEA <b>{data?.monitors.filter((m) => m.status === 'up').length || 0}</b>
          </span>
          <span className="down">
            SIN RESPUESTA <b>{data?.monitors.filter((m) => m.status === 'down').length || 0}</b>
          </span>
          <span>
            ACTUALIZACIÓN <b>30 s</b>
          </span>
        </div>
        {!data ? (
          <p className="wait">Recibiendo señales…</p>
        ) : tab === 'monitors' ? (
          <section className="monitor-table">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Servicio</th>
                    <th>Estado</th>
                    <th>Respuesta</th>
                    <th>Últimas señales</th>
                    <th>Disponibilidad*</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monitors.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <button className="monitor-name" onClick={() => setDetail(m)}>
                          {m.name}
                          <ChevronRight size={13} />
                        </button>
                        <small>{m.url}</small>
                      </td>
                      <td>
                        <State value={m.status} />
                      </td>
                      <td className="numeric">
                        {m.latencyMs === null ? '—' : m.latencyMs + ' ms'}
                      </td>
                      <td>
                        <div className="signal-trail">
                          {m.checks.length ? (
                            m.checks
                              .slice()
                              .reverse()
                              .map((check, i) => (
                                <i
                                  key={i}
                                  className={check.ok ? 'ok' : 'fail'}
                                  title={
                                    dateLabel(check.checkedAt) + ' · ' + check.latencyMs + ' ms'
                                  }
                                />
                              ))
                          ) : (
                            <span>SIN MUESTRAS</span>
                          )}
                        </div>
                      </td>
                      <td className="numeric">{m.uptime === null ? '—' : m.uptime + '%'}</td>
                      <td>
                        <div className="row">
                          <button
                            className="icon"
                            aria-label={'Comprobar ' + m.name}
                            disabled={task.busy || !m.active}
                            onClick={() =>
                              task.perform(async () => {
                                await api('/workspace/monitors/' + m.id + '/check', {
                                  method: 'POST',
                                  body: {},
                                });
                                await reload();
                              })
                            }
                          >
                            <Play size={15} />
                          </button>
                          <button
                            className="icon"
                            aria-label={(m.active ? 'Pausar ' : 'Activar ') + m.name}
                            onClick={() =>
                              task.perform(async () => {
                                await api('/workspace/monitors/' + m.id, {
                                  method: 'PATCH',
                                  body: { active: !m.active },
                                });
                                await reload();
                              })
                            }
                          >
                            {m.active ? <Pause size={15} /> : <Radio size={15} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.monitors.length && (
              <Empty
                title="La consola está esperando su primera señal."
                action={
                  <Button secondary onClick={() => setAdding(true)}>
                    Conectar un servicio
                  </Button>
                }
              >
                Añade una URL pública para empezar a registrar disponibilidad y tiempos de
                respuesta.
              </Empty>
            )}
            <footer>
              * Disponibilidad calculada sobre las últimas 60 comprobaciones guardadas. No se
              inventan datos históricos.
            </footer>
          </section>
        ) : (
          <div className="incident-log">
            {data.incidents.length ? (
              data.incidents.map((item) => (
                <article key={item.id}>
                  <span className={'log-node ' + item.status} />
                  <div>
                    <div className="row">
                      <span className="badge">{incidentLabels[item.status]}</span>
                      <time>{dateLabel(item.updatedAt)}</time>
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.body}</p>
                    <button className="text-control" onClick={() => setIncident(item)}>
                      Actualizar incidente <ChevronRight size={13} />
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <Empty title="Sin incidentes registrados.">
                Las caídas detectadas aparecerán aquí. También puedes comunicar incidencias
                manualmente.
              </Empty>
            )}
          </div>
        )}
        <div className="console-bottom">
          <span>VIGÍA / SELF-HOSTED OBSERVABILITY</span>
          <span>HTTP(S) · Intervalos desde 1 minuto</span>
        </div>
      </main>
      {adding && (
        <MonitorForm
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await reload();
          }}
        />
      )}
      {incident && (
        <IncidentForm
          incident={incident}
          onClose={() => setIncident(null)}
          onSaved={async () => {
            setIncident(null);
            await reload();
          }}
        />
      )}
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <div className="stack">
            <p>{detail.url}</p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Resultado</th>
                    <th>Latencia</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.checks.map((check, i) => (
                    <tr key={i}>
                      <td>{dateLabel(check.checkedAt)}</td>
                      <td>{check.ok ? 'Correcto' : 'Falló'}</td>
                      <td>{check.latencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!detail.checks.length && <p>Todavía no hay comprobaciones.</p>}
          </div>
        </Modal>
      )}
      {link && (
        <LinkModal url={link} title="Página pública de estado" onClose={() => setLink('')} />
      )}
    </div>
  );
}
function State({ value }) {
  return (
    <span className={'monitor-state ' + value}>
      <i />
      {
        { up: 'En línea', down: 'Sin respuesta', unknown: 'Sin comprobar', paused: 'Pausado' }[
          value
        ]
      }
    </span>
  );
}
function MonitorForm({ onClose, onSaved }) {
  const task = useTask();
  function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    task.perform(async () => {
      await api('/workspace/monitors', {
        method: 'POST',
        body: { ...values, intervalMinutes: Number(values.intervalMinutes) },
      });
      await onSaved();
    });
  }
  return (
    <Modal title="Conectar un servicio" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Notice error={task.error} />
        <Field label="Nombre del servicio" name="name" required maxLength={120} />
        <Field
          label="URL pública"
          name="url"
          type="url"
          required
          maxLength={2000}
          hint="Solo HTTP(S) en puertos 80 y 443. Se rechazan redes privadas y destinos locales."
        />
        <Field label="Intervalo">
          <select name="intervalMinutes" defaultValue="5">
            {[1, 5, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} minutos
              </option>
            ))}
          </select>
        </Field>
        <Button busy={task.busy}>Guardar monitor</Button>
      </form>
    </Modal>
  );
}
function IncidentForm({ incident, onClose, onSaved }) {
  const task = useTask();
  function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    task.perform(async () => {
      await api('/workspace/incidents' + (incident.id ? '/' + incident.id : ''), {
        method: incident.id ? 'PATCH' : 'POST',
        body: values,
      });
      await onSaved();
    });
  }
  return (
    <Modal title={incident.id ? 'Actualizar incidente' : 'Registrar incidente'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Notice error={task.error} />
        {!incident.id && <Field label="Título" name="title" maxLength={160} required />}
        {incident.id && (
          <Field label="Estado">
            <select name="status" defaultValue={incident.status}>
              {Object.entries(incidentLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Actualización para el público">
          <textarea
            name="body"
            defaultValue={incident.body || ''}
            maxLength={4000}
            required
            rows={5}
          />
        </Field>
        <Button busy={task.busy}>Guardar actualización</Button>
      </form>
    </Modal>
  );
}
function PublicStatus({ token }) {
  const { data, error, reload } = useData('/status/' + token);
  useEffect(() => {
    const timer = setInterval(() => reload().catch(() => {}), 30000);
    return () => clearInterval(timer);
  }, [reload]);
  return (
    <main className="public-status">
      <Brand />
      <Notice error={error} />
      {data && (
        <>
          <span className="eyebrow">PUBLIC SYSTEM STATUS</span>
          <h1>{data.name}</h1>
          <div className="status-headline">
            <i className={data.monitors.some((m) => m.status === 'down') ? 'down' : 'up'} />
            {!data.monitors.length
              ? 'Sin servicios publicados'
              : data.monitors.some((m) => m.status === 'down')
                ? 'Estamos revisando una interrupción'
                : 'Consulta las señales de cada servicio'}
          </div>
          {data.monitors.map((m) => (
            <article className="public-monitor" key={m.id}>
              <span>{m.name}</span>
              <State value={m.status} />
              <strong>{m.uptime === null ? '—' : m.uptime + '%'}</strong>
            </article>
          ))}
          <h2>Últimas comunicaciones</h2>
          {data.incidents.map((item) => (
            <section className="public-incident" key={item.id}>
              <span className="badge">{incidentLabels[item.status]}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <time>{dateLabel(item.updatedAt)}</time>
            </section>
          ))}
          {!data.incidents.length && <p className="muted">Sin incidentes comunicados.</p>}
        </>
      )}
    </main>
  );
}
