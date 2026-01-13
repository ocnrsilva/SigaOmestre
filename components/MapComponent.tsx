
import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, ZoomControl, useMapEvents } from 'react-leaflet';
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

const MapController: React.FC<{ tripId?: string; pos: GeoPoint | null; destination: Destination | undefined; plannedRoute?: [number, number][]; isActive: boolean }> = ({ tripId, pos, destination, plannedRoute, isActive }) => {
  const map = useMap();
  const initialFitRef = useRef<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);

  // Monitora se o usuário moveu o mapa manualmente para desativar o "seguir"
  useMapEvents({
    dragstart: () => {
      if (isActive) setIsFollowing(false);
    },
  });

  // Força o redimensionamento do mapa para evitar áreas cinzas
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);
    return () => clearTimeout(timer);
  }, [map]);

  // Ajusta o enquadramento inicial ao começar uma viagem
  useEffect(() => {
    if (tripId && initialFitRef.current !== tripId) {
      if (plannedRoute && plannedRoute.length > 0) {
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

  // Navegação Ativa: Segue a posição do usuário com zoom dinâmico
  useEffect(() => {
    if (isActive && pos && isFollowing) {
      map.setView([pos.lat, pos.lng], map.getZoom(), { animate: true, duration: 1.5 });
    }
  }, [pos?.lat, pos?.lng, isActive, isFollowing, map]);

  return (
    isActive && !isFollowing ? (
      <div className="absolute bottom-28 right-4 z-[1000]">
        <button 
          onClick={() => setIsFollowing(true)}
          className="bg-blue-600 text-white p-4 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.2)] active:scale-90 transition-transform flex items-center justify-center border-2 border-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
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
    className: 'bg-blue-600 border-4 border-white rounded-full shadow-lg flex items-center justify-center',
    html: '<div style="font-size: 14px;">👑</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  const followerIcon = L.divIcon({
    className: 'bg-red-500 border-4 border-white rounded-full shadow-lg flex items-center justify-center',
    html: '<div style="font-size: 14px;">🚗</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  const destIcon = L.divIcon({
    className: 'bg-slate-900 border-4 border-white rounded-xl shadow-2xl flex items-center justify-center',
    html: '<div style="font-size: 16px;">🏁</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 36]
  });

  const recordedPath = trip?.path.map(p => [p.lat, p.lng] as [number, number]) || [];
  
  return (
    <div className="absolute inset-0 w-full h-full">
      <MapContainer
        center={userPos ? [userPos.lat, userPos.lng] : [-23.5505, -46.6333]}
        zoom={16}
        zoomControl={false}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />

        {isSelectingDestination && onMapClick && <MapEvents onClick={onMapClick} />}

        {/* Rota Planejada pelas ruas (Caminho azul vibrante estilo Uber/Google Maps) */}
        {trip?.plannedRoute && trip.plannedRoute.length > 0 && (
          <Polyline 
            positions={trip.plannedRoute} 
            color="#3b82f6" 
            weight={10} 
            opacity={0.95} 
            lineJoin="round"
            lineCap="round"
          />
        )}

        {/* Rastro percorrido pelo Mestre (verde para destacar o caminho já feito) */}
        {recordedPath.length > 1 && (
          <Polyline 
            positions={recordedPath} 
            color="#22c55e" 
            weight={12} 
            opacity={0.5} 
            lineJoin="round" 
            lineCap="round"
          />
        )}

        {/* Marcador de Destino */}
        {trip?.destination && (
          <Marker position={[trip.destination.lat, trip.destination.lng]} icon={destIcon} />
        )}

        {/* Marcador do Usuário Atual */}
        {userPos && (
          <Marker 
            position={[userPos.lat, userPos.lng]} 
            icon={role === UserRole.MESTRE ? masterIcon : followerIcon} 
            zIndexOffset={1000}
          />
        )}

        {/* Marcador do Mestre (visível para o seguidor) */}
        {role === UserRole.SEGUIDOR && masterPos && (
          <Marker 
            position={[masterPos.lat, masterPos.lng]} 
            icon={masterIcon} 
            zIndexOffset={900}
          />
        )}

        <MapController 
          tripId={trip?.id}
          pos={userPos} 
          destination={trip?.destination} 
          plannedRoute={trip?.plannedRoute} 
          isActive={!!trip && trip.isActive}
        />
      </MapContainer>
    </div>
  );
};

export default MapComponent;
