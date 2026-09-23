import { nanoid } from 'nanoid';

/** 21-character url-safe id. Used as the primary key for every application table. */
export function newId(): string {
  return nanoid();
}
