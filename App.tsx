
import React, { useState, useEffect, useRef } from 'react';
import { UserRole, Trip, GeoPoint, Destination } from './types';
import MapComponent from './components/MapComponent';
import { storageService } from './services/storage';
import { Navigation, Play, Share2, Users, MapPin, ChevronUp, Copy, Check, LogOut, Search, Loader2, ArrowLeft, History, Clock, ChevronDown, Volume2, VolumeX } from 'lucide-react';
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
  const [selectedDest, setSelectedDest] = useState<Destination | null>(null);
  const [plannedRoute, setPlannedRoute] = useState<[number, number][]>([]);
  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);

  const watchIdRef = useRef<number | null>(null);
  const simulationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecordedPosRef = useRef<GeoPoint | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const lastSpokenStepIndexRef = useRef<number>(-1);
  const lastSpokenMilestoneRef = useRef<'far' | 'near' | null>(null);
  const lastRouteStartPosRef = useRef<GeoPoint | null>(null);
  const lastRouteDestIdRef = useRef<string | null>(null);

  const speak = (text: string) => {
    if (!isVoiceEnabled) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.1;
    window.speechSynthesis.speak(utterance);
  };

  const fetchRoadRoute = async (start: GeoPoint, end: Destination, retryCount = 0) => {
    if (isCalculatingRoute && retryCount === 0) return;
    
    setIsCalculatingRoute(true);
    lastRouteStartPosRef.current = start;
    lastRouteDestIdRef.current = `${end.lat},${end.lng}`;
    
    try {
      // Usando OSRM com geometria completa para seguir as ruas
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=true&language=pt`);
      
      if (!response.ok) throw new Error("Erro no servidor de mapas");
      
      const data = await response.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        // OSRM retorna [lng, lat], precisamos de [lat, lng] para o Leaflet
        const coords = route.geometry.coordinates.map((coord: [number, number]) => [coord[1], coord[0]] as [number, number]);
        
        if (coords.length < 2) throw new Error("Geometria de rota inválida");
        
        setRouteSteps(route.legs[0].steps || []);
        setPlannedRoute(coords);
        setError(null);
      } else {
        throw new Error("Nenhuma rota encontrada pelas ruas");
      }
    } catch (e) {
      console.error("Erro ao traçar rota:", e);
      if (retryCount < 2) {
        setTimeout(() => fetchRoadRoute(start, end, retryCount + 1), 1000);
      } else {
        // Fallback final: Linha reta (apenas se tudo mais falhar)
        const fallbackRoute: [number, number][] = [[start.lat, start.lng], [end.lat, end.lng]];
        setPlannedRoute(fallbackRoute);
        setRouteSteps([{ maneuver: { instruction: "Siga em linha reta até o destino", location: [end.lng, end.lat] } }]);
        setError("Não foi possível carregar o caminho exato. Usando linha reta.");
      }
    } finally {
      if (retryCount >= 0) setIsCalculatingRoute(false);
    }
  };

  useEffect(() => {
    if ("geolocation" in navigator) {
      const id = navigator.geolocation.watchPosition(
        (position) => {
          const newPoint: GeoPoint = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            timestamp: Date.now()
          };
          setUserPos(newPoint);

          if (role === UserRole.MESTRE && currentTrip?.isActive) {
            const distanceMoved = lastRecordedPosRef.current ? calculateDistance(lastRecordedPosRef.current, newPoint) : Infinity;
            if (distanceMoved > 5) {
              const updated = storageService.updateTripPath(currentTrip.code, newPoint);
              if (updated) {
                setCurrentTrip({...updated});
                lastRecordedPosRef.current = newPoint;
              }
            }
          }

          if (currentTrip?.isActive && routeSteps.length > 0) {
            const nextStep = routeSteps[currentStepIndex];
            if (nextStep) {
              const stepPos = { lat: nextStep.maneuver.location[1], lng: nextStep.maneuver.location[0] };
              const distToStep = calculateDistance(newPoint, stepPos);

              if (distToStep <= 200 && distToStep > 50) {
                if (lastSpokenStepIndexRef.current !== currentStepIndex || lastSpokenMilestoneRef.current !== 'far') {
                  speak(`Em duzentos metros, ${nextStep.maneuver.instruction}`);
                  lastSpokenStepIndexRef.current = currentStepIndex;
                  lastSpokenMilestoneRef.current = 'far';
                }
              }
              
              if (distToStep <= 45) {
                if (lastSpokenMilestoneRef.current !== 'near') {
                  speak(nextStep.maneuver.instruction);
                  lastSpokenStepIndexRef.current = currentStepIndex;
                  lastSpokenMilestoneRef.current = 'near';
                  
                  if (currentStepIndex < routeSteps.length - 1) {
                    setTimeout(() => {
                        setCurrentStepIndex(prev => prev + 1);
                        lastSpokenMilestoneRef.current = null;
                    }, 4000);
                  }
                }
              }
            }
          }
        },
        () => setError("Ative o GPS para navegar."),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
      watchIdRef.current = id;
    }
    return () => { if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, [role, currentTrip, routeSteps, currentStepIndex]);

  useEffect(() => {
    if (role === UserRole.SEGUIDOR && currentTrip) {
      simulationIntervalRef.current = setInterval(() => {
        const trip = storageService.getTripByCode(currentTrip.code);
        if (trip) {
          setCurrentTrip({...trip});
          if (trip.path.length > 0) setMasterPos(trip.path[trip.path.length - 1]);
        }
      }, 3000);
    }
    return () => { if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current); };
  }, [role, currentTrip]);

  useEffect(() => {
    if (selectedDest && searchQuery === selectedDest.name) {
      setSuggestions([]);
      return;
    }
    if (searchQuery.length < 3) {
      setSuggestions([]);
      return;
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const locationContext = userPos ? `Lat: ${userPos.lat}, Lng: ${userPos.lng}. ` : "";
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `Sugira 5 locais reais para: "${searchQuery}". ${locationContext}Priorize o mesmo estado do usuário. JSON: name, address, lat, lng.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  lat: { type: Type.NUMBER },
                  lng: { type: Type.NUMBER },
                  name: { type: Type.STRING },
                  address: { type: Type.STRING }
                },
                required: ["lat", "lng", "name", "address"]
              }
            }
          }
        });
        setSuggestions(JSON.parse(response.text));
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearching(false);
      }
    }, 600);
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [searchQuery, userPos, selectedDest]);

  useEffect(() => {
    if (selectedDest && userPos) {
      const destId = `${selectedDest.lat},${selectedDest.lng}`;
      const distFromLastCalc = lastRouteStartPosRef.current ? calculateDistance(userPos, lastRouteStartPosRef.current) : Infinity;
      
      // Só recalcula se o destino mudou ou se o usuário se afastou muito do ponto de origem do cálculo
      if (destId !== lastRouteDestIdRef.current || distFromLastCalc > 100 || plannedRoute.length === 0) {
        fetchRoadRoute(userPos, selectedDest);
      }
    }
  }, [selectedDest, userPos?.lat, userPos?.lng]);

  const handleSelectSuggestion = (suggestion: Destination) => {
    setSelectedDest(suggestion);
    setSearchQuery(suggestion.name);
    setSuggestions([]);
    setPlannedRoute([]); // Força novo cálculo detalhado
  };

  const handleStartTrip = async () => {
    if (!selectedDest || isCalculatingRoute) return;
    
    // Se a rota ainda estiver em linha reta, tenta um último fetch rápido ou usa o que tem
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newTrip: Trip = {
      id: Date.now().toString(),
      code,
      name: "Comboio Siga o Mestre",
      masterId: "me",
      destination: selectedDest,
      plannedRoute: plannedRoute,
      path: userPos ? [userPos] : [],
      isActive: true,
      createdAt: Date.now()
    };

    storageService.saveTrip(newTrip);
    setCurrentTrip(newTrip);
    lastRecordedPosRef.current = userPos;
    setRole(UserRole.MESTRE);
    setIsConfiguringTrip(false);
    setIsBottomSheetOpen(false);
    setCurrentStepIndex(0);
    lastSpokenStepIndexRef.current = -1;
    lastSpokenMilestoneRef.current = null;

    speak("Comboio iniciado. Siga o traçado azul no mapa.");
  };

  if (role === UserRole.NONE && !isConfiguringTrip) {
    return (
      <div className="h-full w-full bg-slate-900 flex flex-col items-center justify-center p-6 text-white overflow-hidden">
        <div className="mb-12 text-center">
          <div className="bg-blue-600 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl">
            <Navigation size={40} className="text-white" />
          </div>
          <h1 className="text-4xl font-extrabold mb-3 tracking-tight">Siga o Mestre</h1>
          <p className="text-slate-400">Comboio inteligente em tempo real.</p>
        </div>
        <div className="w-full max-w-sm space-y-4">
          <button onClick={() => { setIsConfiguringTrip(true); setSelectedDest(null); setPlannedRoute([]); setSearchQuery(''); }} className="w-full bg-blue-600 text-white font-bold py-5 px-6 rounded-2xl flex items-center justify-between shadow-xl active:scale-95 transition-all">
            <div className="flex items-center"><Play size={24} className="mr-4 fill-white"/> Criar Comboio (Mestre)</div>
            <ChevronUp className="rotate-90 opacity-40" />
          </button>
          <div className="relative py-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div>
            <div className="relative flex justify-center text-xs"><span className="bg-slate-900 px-4 text-slate-500 font-bold tracking-widest uppercase">Ou</span></div>
          </div>
          <input type="text" placeholder="Código do Comboio" className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-5 text-white uppercase text-center text-xl font-mono tracking-widest focus:ring-2 focus:ring-blue-500 transition-all" value={inputCode} onChange={(e) => setInputCode(e.target.value)} />
          <button onClick={() => { const trip = storageService.getTripByCode(inputCode); if(trip){ setCurrentTrip(trip); setRole(UserRole.SEGUIDOR); setPlannedRoute(trip.plannedRoute || []); setIsBottomSheetOpen(false); }else{ setError("Código não encontrado."); } }} disabled={!inputCode} className="w-full bg-white text-slate-900 font-bold py-5 px-6 rounded-2xl flex items-center justify-center active:scale-95 transition-all disabled:opacity-50">
            <Users size={24} className="mr-3" /> Entrar como Seguidor
          </button>
          {error && <p className="text-red-400 text-sm text-center mt-2 font-bold">{error}</p>}
        </div>
      </div>
    );
  }

  if (isConfiguringTrip) {
    return (
      <div className="fixed inset-0 flex flex-col bg-white overflow-hidden z-[2000]">
        <div className="relative h-16 bg-slate-900 text-white flex items-center px-4 shrink-0 z-50 shadow-lg">
          <button onClick={() => setIsConfiguringTrip(false)} className="flex items-center text-slate-400 px-2">
            <ArrowLeft className="mr-2" size={20} /> Voltar
          </button>
          <div className="flex-1 text-center font-bold text-lg">Definir Destino</div>
          <div className="w-10"></div>
        </div>

        <div className="flex-grow relative w-full overflow-hidden">
          <MapComponent 
            userPos={userPos} 
            masterPos={null} 
            trip={selectedDest ? { destination: selectedDest, plannedRoute: plannedRoute, path: [] } as any : null} 
            role={UserRole.MESTRE}
            onMapClick={(lat, lng) => handleSelectSuggestion({ lat, lng, name: "Local Selecionado", address: "Localização personalizada no mapa" })}
            isSelectingDestination={true}
          />
          
          <div className="absolute top-4 left-4 right-4 z-[3000]">
            <div className="relative flex shadow-2xl bg-white rounded-2xl overflow-hidden border border-slate-100">
              <div className="flex items-center pl-4 text-slate-400">
                {isSearching ? <Loader2 size={20} className="animate-spin text-blue-500" /> : <Search size={20} />}
              </div>
              <input 
                type="text" 
                placeholder="Para onde vamos?" 
                className="w-full px-4 py-5 border-none focus:ring-0 text-slate-900 font-medium placeholder:text-slate-400"
                value={searchQuery}
                onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if(selectedDest && e.target.value !== selectedDest.name) {
                      setSelectedDest(null);
                      setPlannedRoute([]);
                    }
                }}
              />
            </div>

            {suggestions.length > 0 && !selectedDest && (
              <div className="mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden max-h-[60vh] overflow-y-auto">
                {suggestions.map((item, idx) => (
                  <button key={idx} onClick={() => handleSelectSuggestion(item)} className="w-full px-5 py-4 flex items-start space-x-4 hover:bg-slate-50 border-b border-slate-50 last:border-b-0 text-left">
                    <MapPin size={18} className="text-slate-400 mt-1 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-900 truncate">{item.name}</div>
                      <div className="text-xs text-slate-400 truncate">{item.address}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedDest && (
            <div className="absolute bottom-6 left-4 right-4 z-[2000] bg-white p-6 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] animate-in slide-in-from-bottom duration-300">
              {error && <div className="bg-amber-50 text-amber-700 text-[10px] font-bold p-2 rounded-lg mb-3 border border-amber-200">{error}</div>}
              <div className="flex items-start space-x-4 mb-6">
                <div className="bg-blue-100 p-3 rounded-2xl shrink-0">
                  {isCalculatingRoute ? <Loader2 className="text-blue-600 animate-spin" size={28} /> : <MapPin className="text-blue-600" size={28} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-black text-blue-600 uppercase mb-1">
                    {isCalculatingRoute ? 'Traçando Caminho pelas ruas...' : 'Destino Selecionado'}
                  </div>
                  <div className="text-slate-900 font-extrabold text-xl leading-tight truncate">{selectedDest.name}</div>
                </div>
              </div>
              <button 
                onClick={handleStartTrip} 
                disabled={isCalculatingRoute}
                className={`w-full text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-all flex items-center justify-center text-lg ${isCalculatingRoute ? 'bg-slate-400' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {isCalculatingRoute ? 'Aguarde o cálculo...' : 'Iniciar Comboio'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden">
      <MapComponent userPos={userPos} masterPos={masterPos} trip={currentTrip} role={role} />

      <div className="absolute top-4 left-4 right-4 z-[500] flex flex-col space-y-2">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-xl flex items-center justify-between border border-white/40">
          <div className="flex items-center space-x-3">
            <div className={`${role === UserRole.MESTRE ? 'bg-blue-600' : 'bg-red-500'} w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-lg`}>
              {role === UserRole.MESTRE ? '👑' : '🚗'}
            </div>
            <div>
              <h2 className="font-extrabold text-slate-900 leading-none">
                {role === UserRole.MESTRE ? 'Mestre' : 'Seguidor'}
              </h2>
              <div className="flex items-center text-[10px] text-green-600 font-black uppercase tracking-widest mt-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></div> AO VIVO
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
             <button onClick={() => setIsVoiceEnabled(!isVoiceEnabled)} className={`p-3 rounded-xl transition-all ${isVoiceEnabled ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
               {isVoiceEnabled ? <Volume2 size={22} /> : <VolumeX size={22} />}
             </button>
             <button onClick={() => { setRole(UserRole.NONE); setCurrentTrip(null); }} className="p-3 text-slate-400 hover:text-red-500 bg-slate-50 rounded-xl shadow-inner active:scale-90">
               <LogOut size={22} />
             </button>
          </div>
        </div>

        {currentTrip?.isActive && routeSteps[currentStepIndex] && (
          <div className="bg-blue-600 text-white p-4 rounded-2xl shadow-2xl border-b-4 border-blue-700 animate-in slide-in-from-top">
            <div className="flex items-center space-x-4">
               <div className="bg-white/20 p-2 rounded-lg"><Navigation size={24} className="rotate-45" /></div>
               <div className="flex-1">
                  <div className="text-xs font-bold text-blue-100 uppercase tracking-tight">Próxima Manobra</div>
                  <div className="font-bold text-lg leading-tight">{routeSteps[currentStepIndex].maneuver.instruction}</div>
               </div>
            </div>
          </div>
        )}
      </div>

      <div className={`absolute bottom-0 left-0 right-0 bg-white shadow-2xl rounded-t-[40px] z-[1000] transition-all duration-500 ${isBottomSheetOpen ? 'translate-y-0' : 'translate-y-[calc(100%-80px)]'}`}>
        <div className="w-full flex flex-col items-center py-4 cursor-pointer" onClick={() => setIsBottomSheetOpen(!isBottomSheetOpen)}>
          <div className="w-14 h-1.5 bg-slate-200 rounded-full mb-1"></div>
          {!isBottomSheetOpen && <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Painel de Viagem</div>}
          {isBottomSheetOpen && <ChevronDown size={20} className="text-slate-300" />}
        </div>

        <div className="px-6 pb-10 space-y-6">
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <div className="text-[10px] text-slate-400 font-black uppercase mb-1">Código do Grupo</div>
            <div className="flex items-center justify-between">
                <div className="text-3xl font-mono font-black text-blue-600 tracking-tighter">{currentTrip?.code}</div>
                <button onClick={() => { navigator.clipboard.writeText(currentTrip?.code || ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="p-3 bg-white rounded-xl shadow-sm text-blue-600 active:scale-90">
                  {copied ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
                </button>
            </div>
          </div>

          {currentTrip?.destination && (
            <div className="flex items-center space-x-4 text-slate-600 bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <MapPin size={24} className="text-blue-500 shrink-0" />
              <div className="flex-1 truncate">
                <div className="text-[10px] font-black uppercase text-slate-400">Destino</div>
                <div className="font-bold text-slate-800">{currentTrip.destination.name}</div>
              </div>
            </div>
          )}

          {role === UserRole.MESTRE && (
            <button onClick={() => { if(currentTrip) storageService.saveTrip({...currentTrip, isActive: false}); setCurrentTrip(null); setRole(UserRole.NONE); }} className="w-full bg-red-500 text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-all text-lg">
              Finalizar Viagem
            </button>
          )}

          <button className="w-full border-2 border-slate-100 py-4 rounded-2xl font-bold text-slate-500 flex items-center justify-center hover:bg-slate-50">
            <Share2 className="mr-3" size={20} /> Compartilhar no WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
