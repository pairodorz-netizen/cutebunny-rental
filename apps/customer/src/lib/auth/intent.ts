export interface AuthIntent {
  returnPath: string;
  pendingAction?: string;
}

export function encodeIntent(intent: AuthIntent): string {
  return btoa(JSON.stringify(intent));
}

export function decodeIntent(encoded: string): AuthIntent | null {
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}
