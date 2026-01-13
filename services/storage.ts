
import { Trip, GeoPoint } from '../types';

const TRIPS_KEY = 'siga_o_mestre_trips';

export const storageService = {
  getTrips: (): Trip[] => {
    const data = localStorage.getItem(TRIPS_KEY);
    return data ? JSON.parse(data) : [];
  },

  saveTrip: (trip: Trip) => {
    const trips = storageService.getTrips();
    const index = trips.findIndex(t => t.code === trip.code);
    if (index >= 0) {
      trips[index] = trip;
    } else {
      trips.push(trip);
    }
    localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  },

  getTripByCode: (code: string): Trip | undefined => {
    const trips = storageService.getTrips();
    return trips.find(t => t.code.toUpperCase() === code.toUpperCase());
  },

  updateTripPath: (code: string, point: GeoPoint) => {
    const trips = storageService.getTrips();
    const index = trips.findIndex(t => t.code === code);
    if (index >= 0) {
      trips[index].path.push(point);
      localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
      return trips[index];
    }
    return null;
  }
};
