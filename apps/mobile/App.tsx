import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  PanResponder,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { Audio } from "expo-av";
import type { Station, Track, TunerStation } from "@music-cable-box/shared";
import {
  getStations,
  getTunerStations,
  importLibrary,
  login,
  nextTrack,
  peekStation,
  playStation,
  submitFeedback,
  testNavidrome
} from "./src/api/client";

type Screen = "stations" | "radio" | "player" | "settings";

interface TunerSliderProps {
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  onComplete(value: number): void;
}

function TunerSlider({ value, min, max, onChange, onComplete }: TunerSliderProps) {
  const safeMax = Math.max(min, max);
  const range = Math.max(1, safeMax - min);
  const [trackWidth, setTrackWidth] = useState(0);

  const valueToX = (rawValue: number) => {
    if (trackWidth <= 0) {
      return 0;
    }

    const ratio = (rawValue - min) / range;
    return Math.min(trackWidth, Math.max(0, ratio * trackWidth));
  };

  const xToValue = (x: number) => {
    if (trackWidth <= 0) {
      return value;
    }

    const ratio = Math.min(1, Math.max(0, x / trackWidth));
    return Math.round(min + ratio * range);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const nextValue = xToValue(event.nativeEvent.locationX);
          onChange(nextValue);
        },
        onPanResponderMove: (event) => {
          const nextValue = xToValue(event.nativeEvent.locationX);
          onChange(nextValue);
        },
        onPanResponderRelease: (event) => {
          const nextValue = xToValue(event.nativeEvent.locationX);
          onComplete(nextValue);
        }
      }),
    [onChange, onComplete, trackWidth, min, range, value]
  );

  const thumbX = valueToX(value);

  return (
    <View
      style={styles.tunerTrack}
      onLayout={(event: LayoutChangeEvent) => {
        setTrackWidth(event.nativeEvent.layout.width);
      }}
      {...panResponder.panHandlers}
    >
      <View style={[styles.tunerProgress, { width: thumbX }]} />
      <View style={[styles.tunerThumb, { left: Math.max(0, thumbX - 12) }]} />
    </View>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("stations");
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("change-me");
  const [loginPending, setLoginPending] = useState(false);

  const [baseUrl, setBaseUrl] = useState("http://localhost:4533");
  const [navUsername, setNavUsername] = useState("");
  const [navPassword, setNavPassword] = useState("");
  const [maxArtists, setMaxArtists] = useState("5000");
  const [fullResync, setFullResync] = useState(false);

  const [stations, setStations] = useState<Station[]>([]);
  const [tunerStations, setTunerStations] = useState<TunerStation[]>([]);
  const [loadingStations, setLoadingStations] = useState(false);
  const [loadingTuner, setLoadingTuner] = useState(false);
  const [currentStationId, setCurrentStationId] = useState<string | null>(null);
  const [currentTunerIndex, setCurrentTunerIndex] = useState(0);
  const [scanEnabled, setScanEnabled] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [nextUp, setNextUp] = useState<Track[]>([]);

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const tuneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTunedStationIdRef = useRef<string | null>(null);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false
    }).catch(() => {
      // Ignore mode setup errors in MVP.
    });

    return () => {
      if (tuneTimeoutRef.current) {
        clearTimeout(tuneTimeoutRef.current);
      }
      if (sound) {
        sound.unloadAsync().catch(() => {
          // no-op
        });
      }
    };
  }, [sound]);

  useEffect(() => {
    if (!token) {
      return;
    }

    setLoadingStations(true);
    setLoadingTuner(true);
    Promise.all([getStations(token), getTunerStations(token)])
      .then(([stationItems, tunerItems]) => {
        setStations(stationItems);
        setTunerStations(tunerItems);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load stations"))
      .finally(() => {
        setLoadingStations(false);
        setLoadingTuner(false);
      });
  }, [token]);

  const stationMap = useMemo(() => {
    return new Map(stations.map((station) => [station.id, station]));
  }, [stations]);
  const currentTunerStation = useMemo(
    () => tunerStations[currentTunerIndex] ?? null,
    [currentTunerIndex, tunerStations]
  );

  useEffect(() => {
    if (tunerStations.length === 0) {
      return;
    }

    if (currentTunerIndex > tunerStations.length - 1) {
      setCurrentTunerIndex(tunerStations.length - 1);
    }
  }, [currentTunerIndex, tunerStations.length]);

  useEffect(() => {
    if (!scanEnabled || tunerStations.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      tuneByDelta(1, true);
    }, 2000);

    return () => clearInterval(interval);
  }, [scanEnabled, tunerStations.length, currentTunerIndex]);

  useEffect(() => {
    if (screen !== "radio" && scanEnabled) {
      setScanEnabled(false);
    }
  }, [scanEnabled, screen]);

  async function playTrack(track: Track) {
    if (sound) {
      await sound.unloadAsync().catch(() => {
        // no-op
      });
    }

    const { sound: createdSound } = await Audio.Sound.createAsync(
      {
        uri: track.streamUrl
      },
      {
        shouldPlay: true
      }
    );

    setSound(createdSound);
    setNowPlaying(track);
    setIsPlaying(true);
  }

  async function onLogin() {
    setError(null);
    setStatus(null);
    setLoginPending(true);

    try {
      const response = await login(email, password);
      setToken(response.token);
      setScreen("stations");
      setStatus("Logged in");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoginPending(false);
    }
  }

  async function refreshStations() {
    if (!token) {
      return;
    }

    const [items, tunerItems] = await Promise.all([getStations(token), getTunerStations(token)]);
    setStations(items);
    setTunerStations(tunerItems);
  }

  async function tuneToStation(
    stationId: string,
    options?: {
      openPlayer?: boolean;
      tunerIndex?: number;
    }
  ) {
    if (!token) {
      return;
    }

    setError(null);
    setStatus("Loading channel...");

    try {
      const response = await playStation(stationId, token);
      setCurrentStationId(stationId);
      setNextUp(response.nextUp);
      await playTrack(response.nowPlaying);

      if (options?.tunerIndex !== undefined) {
        setCurrentTunerIndex(options.tunerIndex);
      } else {
        const index = tunerStations.findIndex((item) => item.id === stationId);
        if (index >= 0) {
          setCurrentTunerIndex(index);
        }
      }

      if (options?.openPlayer) {
        setScreen("player");
      }

      setStatus(`Now playing ${stationMap.get(stationId)?.name ?? "station"}`);
      lastTunedStationIdRef.current = stationId;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start station");
    }
  }

  async function onSurfStation(stationId: string) {
    await tuneToStation(stationId, { openPlayer: true });
  }

  async function onTuneIndex(index: number) {
    const station = tunerStations[index];
    if (!station) {
      return;
    }

    setCurrentTunerIndex(index);

    if (!station.isEnabled) {
      setError("Station is disabled.");
      return;
    }

    if (lastTunedStationIdRef.current === station.id && currentStationId === station.id) {
      return;
    }

    await tuneToStation(station.id, {
      tunerIndex: index,
      openPlayer: false
    });
  }

  function scheduleTune(index: number, immediate: boolean) {
    if (tuneTimeoutRef.current) {
      clearTimeout(tuneTimeoutRef.current);
      tuneTimeoutRef.current = null;
    }

    setCurrentTunerIndex(index);
    if (immediate) {
      void onTuneIndex(index);
      return;
    }

    tuneTimeoutRef.current = setTimeout(() => {
      void onTuneIndex(index);
      tuneTimeoutRef.current = null;
    }, 250);
  }

  function tuneByDelta(delta: number, immediate = true) {
    if (tunerStations.length === 0) {
      return;
    }

    const nextIndex = (currentTunerIndex + delta + tunerStations.length) % tunerStations.length;
    scheduleTune(nextIndex, immediate);
  }

  async function onNext() {
    if (!token || !currentStationId) {
      return;
    }

    try {
      let listenSeconds = 0;
      if (sound) {
        const playbackStatus = await sound.getStatusAsync();
        if (playbackStatus.isLoaded) {
          listenSeconds = Math.floor(playbackStatus.positionMillis / 1000);
        }
      }

      const [nextResponse, peekResponse] = await Promise.all([
        nextTrack(currentStationId, token, {
          previousTrackId: nowPlaying?.navidromeSongId,
          listenSeconds,
          skipped: true
        }),
        peekStation(currentStationId, token)
      ]);
      await playTrack(nextResponse.track);
      setNextUp(peekResponse.tracks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load next track");
    }
  }

  async function onTogglePlayPause() {
    if (!sound) {
      return;
    }

    const playbackStatus = await sound.getStatusAsync();
    if (!playbackStatus.isLoaded) {
      return;
    }

    if (playbackStatus.isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  }

  async function onFeedback(liked: boolean) {
    if (!token || !nowPlaying) {
      return;
    }

    try {
      await submitFeedback(token, {
        navidromeSongId: nowPlaying.navidromeSongId,
        liked,
        disliked: !liked
      });
      setStatus(liked ? "Liked" : "Disliked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feedback failed");
    }
  }

  async function onSaveNavidrome() {
    if (!token) {
      return;
    }

    setError(null);

    try {
      await testNavidrome(token, {
        baseUrl,
        username: navUsername,
        password: navPassword
      });
      setStatus("Navidrome connection saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection test failed");
    }
  }

  async function onImportLibrary() {
    if (!token) {
      return;
    }

    const parsedMaxArtists = Number(maxArtists);
    if (!Number.isFinite(parsedMaxArtists) || parsedMaxArtists < 1) {
      setError("Max artists must be a positive number");
      return;
    }

    try {
      const response = await importLibrary(token, {
        fullResync,
        maxArtists: parsedMaxArtists
      });
      setStatus(
        `Imported ${response.result.importedTracks} tracks from ${response.result.importedArtists} artists`
      );
      await refreshStations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.panel}>
          <Text style={styles.title}>Music Cable Box</Text>
          <Text style={styles.meta}>Sign in with API credentials</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />
          <TouchableOpacity style={[styles.button, styles.primary]} onPress={onLogin} disabled={loginPending}>
            <Text style={styles.primaryLabel}>{loginPending ? "Signing in..." : "Sign in"}</Text>
          </TouchableOpacity>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabs}>
        <TouchableOpacity style={styles.tabButton} onPress={() => setScreen("stations")}>
          <Text style={styles.tabLabel}>Stations</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabButton} onPress={() => setScreen("radio")}>
          <Text style={styles.tabLabel}>Radio</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabButton} onPress={() => setScreen("player")}>
          <Text style={styles.tabLabel}>Player</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabButton} onPress={() => setScreen("settings")}>
          <Text style={styles.tabLabel}>Settings</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {screen === "stations" ? (
          <View style={styles.panel}>
            <Text style={styles.title}>Stations</Text>
            {loadingStations ? <ActivityIndicator /> : null}

            <FlatList
              data={stations}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.stationRow}>
                  <Text style={styles.stationName}>{item.name}</Text>
                  <TouchableOpacity
                    style={[styles.button, styles.primary]}
                    onPress={() => onSurfStation(item.id)}
                  >
                    <Text style={styles.primaryLabel}>Surf</Text>
                  </TouchableOpacity>
                </View>
              )}
              scrollEnabled={false}
            />
          </View>
        ) : null}

        {screen === "radio" ? (
          <View style={styles.panel}>
            <Text style={styles.title}>Radio Tuner</Text>
            {loadingTuner ? <ActivityIndicator /> : null}
            {currentTunerStation ? (
              <>
                <Text style={styles.tunerFrequency}>{currentTunerStation.frequencyLabel}</Text>
                <Text style={styles.meta}>{currentTunerStation.name}</Text>
                <TunerSlider
                  value={currentTunerIndex}
                  min={0}
                  max={Math.max(0, tunerStations.length - 1)}
                  onChange={(value) => scheduleTune(value, false)}
                  onComplete={(value) => scheduleTune(value, true)}
                />
                <View style={styles.row}>
                  <TouchableOpacity style={styles.button} onPress={() => tuneByDelta(-1, true)}>
                    <Text>◀ Seek</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.button} onPress={() => tuneByDelta(1, true)}>
                    <Text>Seek ▶</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, scanEnabled ? styles.danger : styles.primary]}
                    onPress={() => setScanEnabled((value) => !value)}
                  >
                    <Text style={scanEnabled ? styles.dangerLabel : styles.primaryLabel}>
                      {scanEnabled ? "Stop Scan" : "Scan"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <Text style={styles.meta}>No tuner stations yet. Generate stations in web UI first.</Text>
            )}
          </View>
        ) : null}

        {screen === "player" ? (
          <View style={styles.panel}>
            <Text style={styles.title}>Now Playing</Text>
            {nowPlaying ? (
              <>
                <Text style={styles.trackTitle}>{nowPlaying.title}</Text>
                <Text style={styles.meta}>
                  {nowPlaying.artist}
                  {nowPlaying.album ? ` • ${nowPlaying.album}` : ""}
                </Text>
                <View style={styles.row}>
                  <TouchableOpacity style={styles.button} onPress={onTogglePlayPause}>
                    <Text>{isPlaying ? "Pause" : "Play"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.button, styles.primary]} onPress={onNext}>
                    <Text style={styles.primaryLabel}>Next</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.row}>
                  <TouchableOpacity style={styles.button} onPress={() => onFeedback(true)}>
                    <Text>Like</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.button} onPress={() => onFeedback(false)}>
                    <Text>Dislike</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.title, { marginTop: 12 }]}>Next Up</Text>
                {nextUp.map((track) => (
                  <Text key={track.navidromeSongId} style={styles.meta}>
                    {track.title} ({track.artist})
                  </Text>
                ))}
              </>
            ) : (
              <Text style={styles.meta}>Choose a station and press Surf.</Text>
            )}
          </View>
        ) : null}

        {screen === "settings" ? (
          <View style={styles.panel}>
            <Text style={styles.title}>Navidrome Settings</Text>
            <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl} placeholder="Base URL" />
            <TextInput
              style={styles.input}
              value={navUsername}
              onChangeText={setNavUsername}
              placeholder="Username"
            />
            <TextInput
              style={styles.input}
              value={navPassword}
              onChangeText={setNavPassword}
              placeholder="Password"
              secureTextEntry
            />
            <TouchableOpacity style={[styles.button, styles.primary]} onPress={onSaveNavidrome}>
              <Text style={styles.primaryLabel}>Test & Save</Text>
            </TouchableOpacity>

            <Text style={[styles.title, { marginTop: 10 }]}>Import</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={maxArtists}
              onChangeText={setMaxArtists}
              placeholder="Max artists"
            />

            <TouchableOpacity
              style={styles.button}
              onPress={() => setFullResync((value) => !value)}
            >
              <Text>{fullResync ? "Full resync enabled" : "Full resync disabled"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.primary]} onPress={onImportLibrary}>
              <Text style={styles.primaryLabel}>Import Library</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {status ? <Text style={styles.status}>{status}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f7f4ef"
  },
  scrollContent: {
    padding: 16,
    gap: 12
  },
  panel: {
    borderRadius: 14,
    borderColor: "#d7d0c5",
    borderWidth: 1,
    padding: 12,
    backgroundColor: "#fffdf8"
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8
  },
  meta: {
    fontSize: 14,
    color: "#575f67",
    marginBottom: 8
  },
  input: {
    borderWidth: 1,
    borderColor: "#d7d0c5",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#fff"
  },
  button: {
    borderWidth: 1,
    borderColor: "#d7d0c5",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center"
  },
  primary: {
    backgroundColor: "#125f8e",
    borderColor: "#125f8e"
  },
  danger: {
    backgroundColor: "#fdf2f2",
    borderColor: "#cf7d7d"
  },
  primaryLabel: {
    color: "#fff",
    fontWeight: "600"
  },
  dangerLabel: {
    color: "#a14545",
    fontWeight: "600"
  },
  tabs: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderBottomWidth: 1,
    borderBottomColor: "#d7d0c5",
    backgroundColor: "#fffdf8"
  },
  tabButton: {
    paddingVertical: 12,
    paddingHorizontal: 8
  },
  tabLabel: {
    fontWeight: "600"
  },
  stationRow: {
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  stationName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600"
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8
  },
  trackTitle: {
    fontSize: 20,
    fontWeight: "700"
  },
  tunerFrequency: {
    fontSize: 52,
    lineHeight: 56,
    fontWeight: "700",
    color: "#0b486d",
    letterSpacing: 2
  },
  tunerTrack: {
    marginTop: 8,
    height: 28,
    borderRadius: 999,
    backgroundColor: "#ece5d9",
    justifyContent: "center",
    position: "relative",
    overflow: "visible"
  },
  tunerProgress: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: "#cddfec"
  },
  tunerThumb: {
    position: "absolute",
    top: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#125f8e"
  },
  status: {
    color: "#125f8e"
  },
  error: {
    color: "#ab2e2e"
  }
});
