import { Import, Play, Waves } from "lucide-react";
import { Cover, Mosaic } from "../components/Cover";
import { TrackList } from "../components/TrackList";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useUi } from "../store/ui";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

export function HomePage() {
  const history = useLibrary((s) => s.history);
  const likes = useLibrary((s) => s.likes);
  const playlists = useLibrary((s) => s.playlists);
  const wave = usePlayer((s) => s.wave);
  const playing = usePlayer((s) => s.playing);
  const { go, openModal } = useUi.getState();
  const recent = history.slice(0, 12).map((h) => h.track);

  return (
    <div className="page">
      <h1>{greeting()}</h1>

      <div className={`wave-hero ${wave && playing ? "live" : ""}`}>
        <div className="wave-blobs">
          <i />
          <i />
          <i />
        </div>
        <div className="wave-content">
          <Waves size={34} />
          <div>
            <h2>Моя волна</h2>
            <p>Бесконечный поток музыки под ваш вкус — на основе того, что вы лайкаете и слушаете.</p>
          </div>
          <button className="btn primary round big" onClick={() => usePlayer.getState().startWave()}>
            <Play size={20} fill="currentColor" /> {wave ? "Перезапустить" : "Слушать"}
          </button>
        </div>
      </div>

      {recent.length > 0 && (
        <section>
          <h2>Недавно играли</h2>
          <div className="shelf">
            {recent.map((t, i) => (
              <button key={t.id} className="shelf-card" onClick={() => usePlayer.getState().playList(recent, i, "Недавно играли")}>
                <div className="shelf-cover">
                  <Cover src={t.cover} size={150} radius={10} />
                  <span className="hover-play">
                    <Play size={20} fill="currentColor" />
                  </span>
                </div>
                <div className="card-title ellipsis">{t.title}</div>
                <div className="muted small ellipsis">{t.artist}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="row">
          <h2 className="grow">Ваши плейлисты</h2>
          <button className="btn ghost small" onClick={() => openModal({ type: "import" })}>
            <Import size={14} /> Перенести музыку
          </button>
        </div>
        {playlists.length ? (
          <div className="shelf">
            {playlists.map((p) => (
              <button key={p.id} className="shelf-card" onClick={() => go({ name: "playlist", id: p.id })}>
                <Mosaic covers={p.tracks.map((t) => t.cover)} size={150} />
                <div className="card-title ellipsis">{p.name}</div>
                <div className="muted small">{p.tracks.length} тр.</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty small">Плейлистов пока нет</div>
        )}
      </section>

      {likes.length > 0 && (
        <section>
          <div className="row">
            <h2 className="grow">Мне нравится</h2>
            <button className="btn ghost small" onClick={() => go({ name: "liked" })}>
              Все {likes.length}
            </button>
          </div>
          <TrackList tracks={likes.slice(0, 8)} context="Мне нравится" />
        </section>
      )}
    </div>
  );
}
