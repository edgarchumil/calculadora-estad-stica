/**
 * ESQUEMA SQLITE: sentencias que server.js ejecuta al crear una base de datos vacía.
 * users: cuentas con email único, sal y hash de contraseña.
 * sessions: huellas de tokens, propietario y fecha de vencimiento en milisegundos.
 * datasets: conjuntos privados; numbers contiene el arreglo numérico serializado como JSON.
 * datasets_owner: índice que ayuda a buscar y ordenar conjuntos por usuario.
 * attempts: contadores y vencimiento del límite de intentos de autenticación.
 * PRIMARY KEY identifica registros; REFERENCES relaciona tablas; ON DELETE CASCADE
 * elimina los registros dependientes al borrar el usuario mediante una operación de BD.
 */
export const schema = `
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL);

CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);

CREATE TABLE datasets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, numbers TEXT NOT NULL, created INTEGER NOT NULL);

CREATE INDEX datasets_owner ON datasets(user_id, created);

CREATE TABLE attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
`;
