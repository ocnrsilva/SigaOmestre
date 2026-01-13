
export interface GeoPoint {
  lat: number;
  lng: number;
  timestamp: number;
}

export interface Destination {
  lat: number;
  lng: number;
  name: string;
  address?: string;
}

export enum UserRole {
  MESTRE = 'MESTRE',
  SEGUIDOR = 'SEGUIDOR',
  NONE = 'NONE'
}

export interface Trip {
  id: string;
  code: string;
  name: string;
  masterId: string;
  destination?: Destination;
  plannedRoute?: [number, number][]; // Polilinha do caminho real pelas ruas
  path: GeoPoint[];
  isActive: boolean;
  createdAt: number;
}

export interface AppState {
  role: UserRole;
  currentTrip: Trip | null;
  userPosition: GeoPoint | null;
  masterPosition: GeoPoint | null;
}
