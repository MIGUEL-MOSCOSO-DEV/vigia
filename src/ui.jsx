import React, { useEffect, useId, useRef, useState, useCallback } from 'react';
import { LoaderCircle, X, ArrowRight, LogOut } from 'lucide-react';
import { api } from './api.js';
import { config } from './config.js';
export function Brand() {
  return (
    <a className="brand" href="/">
      <config.Icon size={24} />
      <strong>{config.name}</strong>
    </a>
  );
}
export function Button({ children, busy, secondary = false, danger = false, ...props }) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={
        'button ' +
        (secondary ? 'secondary ' : '') +
        (danger ? 'danger ' : '') +
        (props.className || '')
      }
    >
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
}
export function Field({ label, children, hint, ...props }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children ? React.cloneElement(children, { id }) : <input {...props} id={id} />}{' '}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function Notice({ error, success }) {
  return error ? (
    <p role="alert" className="notice error">
      {error}
    </p>
  ) : success ? (
    <p role="status" className="notice success">
      {success}
    </p>
  ) : null;
}
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className={'modal ' + (wide ? 'wide' : '')}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" aria-label="Cerrar" className="icon" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <config.Icon size={34} strokeWidth={1} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function perform(task, message = '') {
    if (busy) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await task();
      setSuccess(message);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, success, perform };
}
export function useData(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    const result = await api(path);
    setData(result);
    setError('');
    return result;
  }, [path]);
  useEffect(() => {
    let active = true;
    setData(null);
    api(path)
      .then((result) => {
        if (active) {
          setData(result);
          setError('');
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [path]);
  return { data, error, reload };
}
export function Session({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api('/auth/me')
      .then((result) => setUser(result.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return (
      <div className="loading">
        <Brand />
        <LoaderCircle className="spin" />
      </div>
    );
  if (user) return children(user, setUser);
  return <Auth onUser={setUser} />;
}
function Auth({ onUser }) {
  const [register, setRegister] = useState(false);
  const task = useTask();
  function submit(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    task.perform(async () => {
      const { user } = await api('/auth/' + (register ? 'register' : 'login'), {
        method: 'POST',
        body,
      });
      onUser(user);
    });
  }
  return (
    <main className={'auth ' + config.slug}>
      <section className="auth-story">
        <Brand />
        <span className="auth-index">{config.tag}</span>
        <h1>{config.claim}</h1>
        <p>{config.description}</p>
        <div className="auth-art" aria-hidden="true">
          <config.Icon size={100} strokeWidth={0.6} />
        </div>
        <footer>Tu espacio. Tus datos. Sin cuentas de demostración.</footer>
      </section>
      <section className="auth-entry">
        <span className="eyebrow">{config.name} / acceso</span>
        <h2>{register ? 'Empieza aquí.' : 'Continúa tu trabajo.'}</h2>
        <form className="stack" onSubmit={submit}>
          <Notice error={task.error} />
          {register && (
            <Field
              label="Tu nombre"
              name="name"
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
            />
          )}
          <Field
            label="Correo electrónico"
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
          />
          <Field
            label="Contraseña"
            type="password"
            name="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete={register ? 'new-password' : 'current-password'}
            hint={register ? 'Mínimo 10 caracteres.' : undefined}
          />
          <Button busy={task.busy}>
            {register ? 'Crear cuenta' : 'Entrar'}
            <ArrowRight size={17} />
          </Button>
        </form>
        <p className="auth-switch">
          {register ? '¿Ya tienes cuenta?' : '¿Es tu primera vez?'}{' '}
          <button onClick={() => setRegister(!register)}>
            {register ? 'Inicia sesión' : 'Crea una cuenta'}
          </button>
        </p>
      </section>
    </main>
  );
}
export function Identity({ user, onUser }) {
  const task = useTask();
  return (
    <div className="identity">
      <span>{user.name}</span>
      <button
        aria-label="Cerrar sesión"
        className="icon"
        onClick={() =>
          task.perform(async () => {
            await api('/auth/logout', { method: 'POST', body: {} });
            onUser(null);
          })
        }
      >
        <LogOut size={17} />
      </button>
      <Notice error={task.error} />
    </div>
  );
}
export const money = (cents, currency = 'USD') =>
  new Intl.NumberFormat('es', { style: 'currency', currency }).format(cents / 100);
export const dateLabel = (value) =>
  value ? new Date(value).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const today = () => new Date().toISOString().slice(0, 10);
export function LinkModal({ url, onClose, title = 'Enlace privado' }) {
  const task = useTask();
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <p>Guarda este enlace antes de cerrar. Generar otro invalidará el anterior.</p>
        <a className="share" href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
        <Notice error={task.error} success={task.success} />
        <Button
          onClick={() => task.perform(() => navigator.clipboard.writeText(url), 'Enlace copiado.')}
        >
          Copiar enlace
        </Button>
      </div>
    </Modal>
  );
}
