
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UserRole, Trip, GeoPoint, Destination } from './types';
import MapComponent from './components/MapComponent';
import { storageService } from './services/storage';
import { Navigation, Play, Share2, Users, MapPin, ChevronUp, Copy, Check, LogOut, Search, Loader2, ArrowLeft, Volume2, VolumeX, ChevronDown, AlertCircle, RefreshCw, X, Zap } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";

const calculateDistance = (p1: GeoPoint | {lat: number, lng: number}, p2: GeoPoint | {lat: number, lng: number}) => {
  const R = 6371e3;
  const φ1 = p1.lat * Math.PI / 180;
  const φ2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const App: React.FC = () => {
  const [role, setRole] = useState<UserRole>(UserRole.NONE);
  const [isConfiguringTrip, setIsConfiguringTrip] = useState(false);
  const [currentTrip, setCurrentTrip] = useState<Trip | null>(null);
  const [userPos, setUserPos] = useState<GeoPoint | null>(null);
  const [masterPos, setMasterPos] = useState<GeoPoint | null>(null);
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(true);
  const [inputCode, setInputCode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Destination[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [routeLoadingStatus, setRouteLoadingStatus] = useState('');
  const [selectedDest, setSelectedDest] = useState<Destination | null>(null);
  const [plannedRoute, setPlannedRoute] = useState<[number, number][]>([]);
  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);

  const watchIdRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const lastRecordedPosRef = useRef<GeoPoint | null>(null);
  
  const stateRef = useRef({ plannedRoute, isCalculatingRoute, selectedDest, userPos, role, currentTrip });
  useEffect(() => {
    stateRef.current = { plannedRoute, isCalculatingRoute, selectedDest, userPos, role, currentTrip };
  }, [plannedRoute, isCalculatingRoute, selectedDest, userPos, role, currentTrip]);

  const speak = useCallback((text: string) => {
    if (!isVoiceEnabled) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    window.speechSynthesis.speak(utterance);
  }, [isVoiceEnabled]);

  const updateRoute = async (start: GeoPoint, end: Destination) => {
    if (stateRef.current.plannedRoute.length === 0) {
      setPlannedRoute([[start.lat, start.lng], [end.lat, end.lng]]);
    }

    if (fetchControllerRef.current) fetchControllerRef.current.abort();
    fetchControllerRef.current = new AbortController();

    setIsCalculatingRoute(true);
    setRouteLoadingStatus('Otimizando percurso...');

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=true&language=pt`;
      const response = await fetch(url, { signal: fetchControllerRef.current.signal });
      const data = await response.json();

      if (data.routes && data.routes[0]) {
        const route = data.routes[0];
        const coords: [number, number][] = route.geometry.coordinates.map((c: any) => [c[1], c[0]]);
        
        if (coords.length >= 2) {
          setPlannedRoute(coords);
          setRouteSteps(route.legs[0].steps || []);
          setCurrentStepIndex(0);
          setError(null);
          
          if (stateRef.current.role === UserRole.MESTRE && stateRef.current.currentTrip) {
            const updated = { ...stateRef.current.currentTrip, plannedRoute: coords };
            storageService.saveTrip(updated);
            setCurrentTrip(updated);
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setRouteLoadingStatus('Modo Direto Ativado');
      }
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  // GPS E GRAVAÇÃO DE RASTRO
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const newPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude, timestamp: Date.now() };
        setUserPos(newPoint);

        const { role, currentTrip } = stateRef.current;

        // SE FOR MESTRE: Grava o rastro se moveu mais de 10 metros
        if (role === UserRole.MESTRE && currentTrip?.isActive) {
          if (!lastRecordedPosRef.current || calculateDistance(lastRecordedPosRef.current, newPoint) > 10) {
            const updatedTrip = storageService.updateTripPath(currentTrip.code, newPoint);
            if (updatedTrip) {
              setCurrentTrip({ ...updatedTrip });
              lastRecordedPosRef.current = newPoint;
            }
          }
        }
      },
      null,
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
    return () => { if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, []);

  // SINCRONIZAÇÃO DO SEGUIDOR (Simula recebimento de dados do mestre)
  useEffect(() => {
    if (role !== UserRole.SEGUIDOR || !currentTrip) return;

    const syncInterval = setInterval(() => {
      const masterTrip = storageService.getTripByCode(currentTrip.code);
      if (masterTrip && masterTrip.isActive) {
        // Pega a última posição conhecida do mestre no rastro
        if (masterTrip.path.length > 0) {
          const lastPoint = masterTrip.path[masterTrip.path.length - 1];
          setMasterPos(lastPoint);
        }
        // Atualiza o rastro e a rota no mapa do seguidor
        setCurrentTrip({ ...masterTrip });
        setPlannedRoute(masterTrip.plannedRoute || []);
      } else if (masterTrip && !masterTrip.isActive) {
        speak("O comboio foi encerrado pelo mestre.");
        setRole(UserRole.NONE);
        setCurrentTrip(null);
      }
    }, 3000); // Sincroniza a cada 3 segundos

    return () => clearInterval(syncInterval);
  }, [role, currentTrip?.code]);

  useEffect(() => {
    if (selectedDest && userPos && isConfiguringTrip) {
      updateRoute(userPos, selectedDest);
    }
  }, [selectedDest, isConfiguringTrip]);

  useEffect(() => {
    if (selectedDest && searchQuery === selectedDest.name) return;
    if (searchQuery.length < 3) { setSuggestions([]); return; }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
        const resp = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `Ache 5 lugares: "${searchQuery}" perto de ${userPos?.lat}, ${userPos?.lng}. JSON com name, address, lat, lng.`,
          config: { responseMimeType: "application/json" }
        });
        if (resp?.text) setSuggestions(JSON.parse(resp.text));
      } catch (e) { console.error(e); } finally { setIsSearching(false); }
    }, 1000);
  }, [searchQuery]);

  const handleStartTrip = () => {
    if (!selectedDest) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newTrip: Trip = {
      id: Date.now().toString(),
      code,
      name: `Comboio para ${selectedDest.name}`,
      masterId: "me",
      destination: selectedDest,
      plannedRoute: plannedRoute,
      path: userPos ? [userPos] : [], // Primeiro ponto do rastro
      isActive: true,
      createdAt: Date.now()
    };
    storageService.saveTrip(newTrip);
    setCurrentTrip(newTrip);
    setRole(UserRole.MESTRE);
    setIsConfiguringTrip(false);
    setIsBottomSheetOpen(false);
    speak("Comboio iniciado. Seu rastro está sendo gravado.");
  };

  if (role === UserRole.NONE && !isConfiguringTrip) {
    return (
      <div className="h-full w-full bg-slate-900 flex flex-col items-center justify-center p-6 text-white overflow-hidden">
        <div className="mb-12 text-center">
          <div className="bg-blue-600 w-24 h-24 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 shadow-[0_0_50px_rgba(37,99,235,0.4)]">
            <Navigation size={48} className="text-white fill-white/20" />
          </div>
          <h1 className="text-5xl font-black mb-3 tracking-tighter">Siga o Mestre</h1>
          <p className="text-slate-400 text-lg">Navegação em grupo sem atrasos.</p>
        </div>
        <div className="w-full max-w-sm space-y-4">
          <button onClick={() => setIsConfiguringTrip(true)} className="w-full bg-blue-600 text-white font-black py-6 px-6 rounded-3xl flex items-center justify-between shadow-xl active:scale-95 transition-all">
            <div className="flex items-center"><Play size={28} className="mr-4 fill-white"/> Criar Comboio</div>
            <Zap size={20} className="text-blue-200 animate-pulse" />
          </button>
          <div className="relative py-4"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div><div className="relative flex justify-center text-xs text-slate-500 uppercase font-black"><span className="bg-slate-900 px-4">Ou entre em um</span></div></div>
          <input type="text" placeholder="CÓDIGO" className="w-full bg-slate-800 border-2 border-slate-700 rounded-2xl px-5 py-5 text-white uppercase text-center text-2xl font-mono font-black tracking-widest outline-none focus:border-blue-500 transition-all placeholder:opacity-20" value={inputCode} onChange={(e) => setInputCode(e.target.value)} />
          <button onClick={() => { const trip = storageService.getTripByCode(inputCode); if(trip){ setCurrentTrip(trip); setRole(UserRole.SEGUIDOR); setPlannedRoute(trip.plannedRoute || []); setMasterPos(trip.path.length > 0 ? trip.path[trip.path.length-1] : null); setIsBottomSheetOpen(false); }else{ setError("Código inválido."); } }} disabled={!inputCode} className="w-full bg-white text-slate-900 font-black py-5 px-6 rounded-2xl flex items-center justify-center active:scale-95 transition-all shadow-xl">
             Entrar como Seguidor
          </button>
          {error && <div className="text-red-400 text-center font-bold text-sm">{error}</div>}
        </div>
      </div>
    );
  }

  if (isConfiguringTrip) {
    return (
      <div className="fixed inset-0 flex flex-col bg-white overflow-hidden z-[2000]">
        <div className="h-16 bg-slate-900 text-white flex items-center px-4 shrink-0 z-[3000]">
          <button onClick={() => { setIsConfiguringTrip(false); setSelectedDest(null); setPlannedRoute([]); if(fetchControllerRef.current) fetchControllerRef.current.abort(); }} className="flex items-center text-slate-400 font-bold"><ArrowLeft className="mr-2" size={20} /> Cancelar</button>
          <div className="flex-1 text-center font-black">Definir Destino</div>
          <div className="w-10"></div>
        </div>
        <div className="flex-grow relative w-full overflow-hidden">
          <MapComponent 
            userPos={userPos} 
            trip={selectedDest ? { destination: selectedDest, plannedRoute: plannedRoute, path: [] } as any : null} 
            role={UserRole.MESTRE}
            onMapClick={(lat, lng) => { setSelectedDest({ lat, lng, name: "Local no Mapa" }); setPlannedRoute([]); }}
            isSelectingDestination={true} masterPos={null}
          />
          <div className="absolute top-4 left-4 right-4 z-[4000]">
            <div className="relative flex shadow-2xl bg-white rounded-2xl overflow-hidden border border-slate-100 p-1">
              <div className="flex items-center pl-4 text-slate-400">{isSearching ? <Loader2 size={24} className="animate-spin text-blue-500" /> : <Search size={24} />}</div>
              <input type="text" placeholder="Pesquisar endereço ou local..." className="w-full px-4 py-5 border-none focus:ring-0 text-slate-900 font-bold" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            {suggestions.length > 0 && !selectedDest && (
              <div className="mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden max-h-[50vh] overflow-y-auto">
                {suggestions.map((item, idx) => (
                  <button key={idx} onClick={() => { setSelectedDest(item); setSearchQuery(item.name); setSuggestions([]); }} className="w-full px-5 py-4 flex items-start space-x-4 hover:bg-blue-50 border-b border-slate-50 text-left">
                    <MapPin size={20} className="text-slate-400 mt-1" />
                    <div className="flex-1 truncate">
                      <div className="font-bold text-slate-900 truncate">{item.name}</div>
                      <div className="text-xs text-slate-400 truncate">{item.address}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedDest && (
            <div className="absolute bottom-8 left-4 right-4 z-[4000] bg-white p-6 rounded-[2.5rem] shadow-2xl border border-slate-50 animate-in slide-in-from-bottom duration-500">
              <div className="flex items-start space-x-4 mb-6">
                <div className="bg-blue-600 p-4 rounded-2xl shrink-0 text-white shadow-lg">
                   {isCalculatingRoute ? <Loader2 className="animate-spin" size={32} /> : <MapPin size={32} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">{isCalculatingRoute ? routeLoadingStatus : 'Destino Selecionado'}</div>
                  <div className="text-slate-900 font-black text-2xl truncate leading-tight">{selectedDest.name}</div>
                  {!isCalculatingRoute && <div className="text-xs text-green-600 font-bold flex items-center mt-1"><Check size={14} className="mr-1"/> Percurso pronto</div>}
                </div>
              </div>
              <button onClick={handleStartTrip} className="w-full bg-blue-600 text-white font-black py-6 rounded-3xl shadow-[0_15px_30px_rgba(37,99,235,0.3)] active:scale-95 transition-all text-xl">
                Iniciar Comboio Agora
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden bg-slate-900">
      <MapComponent userPos={userPos} masterPos={masterPos} trip={currentTrip} role={role} />
      
      <div className="absolute top-4 left-4 right-4 z-[500] flex flex-col space-y-3 pointer-events-none">
        <div className="bg-white/95 backdrop-blur-xl rounded-[2rem] p-4 shadow-2xl flex items-center justify-between border border-white pointer-events-auto">
          <div className="flex items-center space-x-4">
            <div className={`${role === UserRole.MESTRE ? 'bg-blue-600' : 'bg-red-500'} w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg text-2xl`}>
              {role === UserRole.MESTRE ? '👑' : '🚗'}
            </div>
            <div>
              <h2 className="font-black text-slate-900 text-lg leading-tight">{role === UserRole.MESTRE ? 'Líder' : 'Seguindo'}</h2>
              <div className="flex items-center text-[10px] text-green-600 font-black uppercase tracking-widest mt-1"><div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></div> AO VIVO</div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
             <button onClick={() => setIsVoiceEnabled(!isVoiceEnabled)} className={`p-3.5 rounded-2xl transition-all ${isVoiceEnabled ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
               {isVoiceEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
             </button>
             <button onClick={() => { if(window.confirm("Sair do comboio?")) { setRole(UserRole.NONE); setCurrentTrip(null); setPlannedRoute([]); } }} className="p-3.5 text-slate-400 bg-slate-50 rounded-2xl shadow-inner active:scale-90">
               <LogOut size={24} />
             </button>
          </div>
        </div>
        {isCalculatingRoute && <div className="self-center bg-blue-600/90 backdrop-blur-md text-white px-6 py-2 rounded-full font-black text-[10px] uppercase tracking-widest shadow-lg animate-pulse border border-white/20 pointer-events-none">Ajustando percurso...</div>}
      </div>

      <div className={`absolute bottom-0 left-0 right-0 bg-white shadow-[0_-20px_60px_rgba(0,0,0,0.15)] rounded-t-[3.5rem] z-[1000] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${isBottomSheetOpen ? 'translate-y-0' : 'translate-y-[calc(100%-100px)]'}`}>
        <div className="w-full flex flex-col items-center py-6 cursor-pointer" onClick={() => setIsBottomSheetOpen(!isBottomSheetOpen)}>
          <div className="w-12 h-1.5 bg-slate-200 rounded-full mb-1"></div>
        </div>
        <div className="px-8 pb-12 space-y-6">
          <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100 flex items-center justify-between shadow-inner">
            <div className="flex-1">
               <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">Código de Acesso</div>
               <div className="text-4xl font-mono font-black text-blue-600 tracking-tighter">{currentTrip?.code}</div>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(currentTrip?.code || ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="p-5 bg-white rounded-3xl shadow-sm text-blue-600 active:scale-90 transition-all border border-slate-100">
              {copied ? <Check size={24} className="text-green-500" /> : <Copy size={24} />}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {role === UserRole.MESTRE && (
              <button onClick={() => { if(window.confirm("Deseja encerrar o comboio para todos?")) { if(currentTrip) storageService.saveTrip({...currentTrip, isActive: false}); setCurrentTrip(null); setRole(UserRole.NONE); setPlannedRoute([]); } }} className="w-full bg-red-500 text-white font-black py-6 rounded-3xl shadow-xl active:scale-95 transition-all text-xl">Encerrar Viagem</button>
            )}
            <button onClick={() => window.open(`https://wa.me/?text=Siga meu comboio no Siga o Mestre! Use o código: ${currentTrip?.code}`, '_blank')} className="w-full border-2 border-slate-100 py-5 rounded-3xl font-black text-slate-600 flex items-center justify-center hover:bg-slate-50 transition-colors">
              <Share2 className="mr-3 text-blue-500" size={24} /> Convidar via WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
