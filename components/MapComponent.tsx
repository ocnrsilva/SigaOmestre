
import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, ZoomControl, useMapEvents, Circle } from 'react-leaflet';
import L from 'leaflet';
import { Trip, GeoPoint, UserRole, Destination } from '../types';

interface MapProps {
  userPos: GeoPoint | null;
  masterPos: GeoPoint | null;
  trip: Trip | null;
  role: UserRole;
  onMapClick?: (lat: number, lng: number) => void;
  isSelectingDestination?: boolean;
}

const MapController: React.FC<{ 
  tripId?: string; 
  pos: GeoPoint | null; 
  plannedRoute?: [number, number][]; 
  isActive: boolean 
}> = ({ tripId, pos, plannedRoute, isActive }) => {
  const map = useMap();
  const initialFitRef = useRef<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);

  useMapEvents({
    dragstart: () => {
      if (isActive) setIsFollowing(false);
    },
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 300);
    return () => clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    if (tripId && initialFitRef.current !== tripId) {
      if (plannedRoute && plannedRoute.length >= 2) {
        const bounds = L.latLngBounds(plannedRoute);
        map.fitBounds(bounds, { padding: [100, 100], maxZoom: 16 });
        initialFitRef.current = tripId;
        setIsFollowing(true);
      } else if (pos) {
        map.setView([pos.lat, pos.lng], 16);
        initialFitRef.current = tripId;
        setIsFollowing(true);
      }
    }
    if (!tripId) initialFitRef.current = null;
  }, [tripId, plannedRoute, pos, map]);

  useEffect(() => {
    if (isActive && pos && isFollowing) {
      map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 16), { 
        animate: true, 
        duration: 1.5 
      });
    }
  }, [pos?.lat, pos?.lng, isActive, isFollowing, map]);

  return (
    isActive && !isFollowing ? (
      <div className="absolute bottom-36 right-6 z-[1000]">
        <button 
          onClick={() => setIsFollowing(true)}
          className="bg-blue-600 text-white p-4 rounded-full shadow-[0_15px_30px_rgba(37,99,235,0.4)] active:scale-90 transition-all border-4 border-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="rotate-45"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        </button>
      </div>
    ) : null
  );
};

const MapEvents: React.FC<{ onClick: (lat: number, lng: number) => void }> = ({ onClick }) => {
  useMapEvents({
    click: (e) => onClick(e.latlng.lat, e.latlng.lng),
  });
  return null;
};

const MapComponent: React.FC<MapProps> = ({ userPos, masterPos, trip, role, onMapClick, isSelectingDestination }) => {
  const masterIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: #2563eb; width: 36px; height: 36px; border-radius: 50%; border: 4px solid white; box-shadow: 0 4px 15px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 16px;">👑</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  const followerIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: #ef4444; width: 32px; height: 32px; border-radius: 50%; border: 4px solid white; box-shadow: 0 4px 15px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 14px;">🚗</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  const destIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: #0f172a; width: 40px; height: 40px; border-radius: 14px; border: 4px solid white; box-shadow: 0 8px 25px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; font-size: 20px;">🏁</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  const routePoints = trip?.plannedRoute || [];
  const recordedPath = trip?.path.map(p => [p.lat, p.lng] as [number, number]) || [];
  
  return (
    <div className="absolute inset-0 w-full h-full bg-slate-100">
      <MapContainer
        center={userPos ? [userPos.lat, userPos.lng] : [-23.5505, -46.6333]}
        zoom={16}
        zoomControl={false}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <ZoomControl position="bottomright" />

        {isSelectingDestination && onMapClick && <MapEvents onClick={onMapClick} />}

        {/* ROTA PLANEJADA (AZUL) */}
        {routePoints.length >= 2 && (
          <>
            <Polyline 
              positions={routePoints} 
              pathOptions={{ color: '#1e40af', weight: 14, opacity: 0.2, lineJoin: 'round', lineCap: 'round' }} 
            />
            <Polyline 
              positions={routePoints} 
              pathOptions={{ 
                color: '#60a5fa', 
                weight: 6, 
                opacity: 0.8, 
                lineJoin: 'round', 
                lineCap: 'round',
                dashArray: routePoints.length === 2 ? '10, 10' : undefined 
              }} 
            />
          </>
        )}

        {/* RASTRO REAL PERCORRIDO (VERDE - "MIGALHAS DE PÃO") */}
        {recordedPath.length >= 2 && (
          <>
            {/* Brilho do rastro */}
            <Polyline 
              positions={recordedPath} 
              pathOptions={{ color: '#10b981', weight: 10, opacity: 0.15, lineJoin: 'round', lineCap: 'round' }}
            />
            {/* Linha do rastro tracejada */}
            <Polyline 
              positions={recordedPath} 
              pathOptions={{ color: '#059669', weight: 4, opacity: 1, lineJoin: 'round', lineCap: 'round', dashArray: '1, 15' }}
            />
          </>
        )}

        {trip?.destination && (
          <Marker position={[trip.destination.lat, trip.destination.lng]} icon={destIcon} />
        )}

        {userPos && (
          <Circle 
            center={[userPos.lat, userPos.lng]} 
            radius={20} 
            pathOptions={{ fillColor: '#3b82f6', fillOpacity: 0.15, color: 'transparent' }} 
          />
        )}

        {userPos && (
          <Marker 
            position={[userPos.lat, userPos.lng]} 
            icon={role === UserRole.MESTRE ? masterIcon : followerIcon} 
            zIndexOffset={1000}
          />
        )}

        {role === UserRole.SEGUIDOR && masterPos && (
          <Marker 
            position={[masterPos.lat, masterPos.lng]} 
            icon={masterIcon} 
            zIndexOffset={950}
          />
        )}

        <MapController 
          tripId={trip?.id}
          pos={userPos} 
          plannedRoute={routePoints} 
          isActive={!!trip && trip.isActive}
        />
      </MapContainer>
    </div>
  );
};

export default MapComponent;
