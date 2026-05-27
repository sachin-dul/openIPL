import Link from "next/link";
import { teamShort } from "@/lib/teams";
import { TeamBadge } from "@/components/team-badge";

// All matrix cells share these dimensions — including the top-left and the
// header rows/columns — so the grid stays a clean square regardless of which
// season is rendered.
const CELL_W = 78;
const CELL_H = 56;

/**
 * Head-to-head matrix: rows are home teams, columns are visiting teams. Each
 * cell shows the winner short code on top and the margin underneath, tinted
 * blue when the home team won and red when the visitor did. Yellow marks a
 * match abandoned without result; grey marks the diagonal and pairings that
 * didn't play in this season's format.
 *
 * Home/away assignment uses each team's most-played venue(s) of the season;
 * matches at a true neutral ground (rare — e.g. 2009 SA, 2020 UAE) fall back
 * to whichever side has more home venues at that ground, then to team_1.
 *
 * Playoffs sit in a strip below the matrix because the home/away axis no
 * longer applies (neutral venues, single-leg ties).
 */

export type MatchRow = {
  team_1: string;
  team_2: string;
  venue: string;
  winner: string | null;
  win_by_runs: number | null;
  win_by_wickets: number | null;
  result: string | null;
  match_stage: string | null;
  cricsheet_match_id: number | null;
  date: string;
};

type Props = {
  teams: string[]; // canonical team names, ordered as we want to display them
  matches: MatchRow[]; // every match in the season (league + playoffs)
};

type Cell =
  | { kind: "diagonal" }
  | { kind: "empty" }
  | {
      kind: "result";
      winnerShort: string | null; // null when abandoned
      margin: string;
      homeWon: boolean | null; // null when abandoned/tie-unresolved
      cricsheetId: number | null;
    };

export function HeadToHeadMatrix({ teams, matches }: Props) {
  const homeVenuesByTeam = inferHomeVenues(matches, teams);
  const league = matches.filter(
    (m) => (m.match_stage ?? "league").toLowerCase() === "league",
  );
  const playoffs = matches.filter((m) => {
    const s = (m.match_stage ?? "").toLowerCase();
    return s !== "" && s !== "league" && s !== "league_replayed";
  });

  // Build the matrix: cells[home][visitor]. If a cell is already filled when
  // a second match maps to it (venue inference ambiguity), fall back to the
  // mirror cell so we never silently drop a leg.
  const cells: Record<string, Record<string, Cell>> = {};
  for (const home of teams) {
    cells[home] = {};
    for (const visitor of teams) {
      cells[home][visitor] = home === visitor ? { kind: "diagonal" } : { kind: "empty" };
    }
  }
  for (const m of league) {
    const preferredHome = pickHome(m, homeVenuesByTeam);
    const preferredVisitor = preferredHome === m.team_1 ? m.team_2 : m.team_1;
    if (!cells[preferredHome] || !cells[preferredHome][preferredVisitor]) continue;
    const target = cells[preferredHome][preferredVisitor];
    if (target.kind === "result") {
      // Slot taken — drop into the mirror cell instead.
      const mirror = cells[preferredVisitor]?.[preferredHome];
      if (mirror && mirror.kind === "empty") {
        cells[preferredVisitor][preferredHome] = buildResultCell(m, preferredVisitor, preferredHome);
      }
      continue;
    }
    cells[preferredHome][preferredVisitor] = buildResultCell(m, preferredHome, preferredVisitor);
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div>
        <MatrixTable teams={teams} cells={cells} />
        <Legend />
      </div>
      {playoffs.length > 0 && <PlayoffStrip playoffs={playoffs} />}
    </div>
  );
}

function MatrixTable({
  teams,
  cells,
}: {
  teams: string[];
  cells: Record<string, Record<string, Cell>>;
}) {
  // Fixed table layout + a colgroup pin every column to CELL_W, so headers and
  // body cells match exactly even when team short codes are different widths.
  return (
    <div className="overflow-x-auto sleek-scroll shrink-0">
      <table className="text-[11px] border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: CELL_W }} />
          {teams.map((t) => (
            <col key={t} style={{ width: CELL_W }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ height: CELL_H }}>
            <th className="p-0 align-middle text-[10px] text-ipl-sub leading-tight font-medium border-b border-r border-ipl-line bg-ipl-bg2">
              <div className="px-1.5 leading-[1.2] text-left">
                <div>Visitor →</div>
                <div>Home ↓</div>
              </div>
            </th>
            {teams.map((t) => (
              <th
                key={t}
                className="p-0 border-b border-r border-ipl-line bg-ipl-bg2 text-center"
              >
                <HeaderCellContent team={t} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((home) => (
            <tr key={home} style={{ height: CELL_H }}>
              <th
                className="p-0 border-b border-r border-ipl-line bg-ipl-bg2 text-center"
                scope="row"
              >
                <HeaderCellContent team={home} />
              </th>
              {teams.map((visitor) => {
                const cell = cells[home][visitor];
                return (
                  <td
                    key={visitor}
                    className="border-b border-r border-ipl-line2 p-0"
                    style={{ background: cellBg(cell) }}
                  >
                    <CellRender cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeaderCellContent({ team }: { team: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 px-1">
      <TeamBadge team={team} size={20} />
      <span className="font-mono font-semibold text-[10px] text-ipl-ink">
        {teamShort(team)}
      </span>
    </div>
  );
}

/** Background tint for a cell. The td paints the tint so the fill reaches
 *  every border; the inner content is transparent. */
function cellBg(cell: Cell): string {
  if (cell.kind === "diagonal") return CELL_BG.diagonal;
  if (cell.kind === "empty") return CELL_BG.empty;
  if (cell.homeWon === null) return CELL_BG.abandoned;
  return cell.homeWon ? CELL_BG.homeWin : CELL_BG.visitorWin;
}

function CellRender({ cell }: { cell: Cell }) {
  if (cell.kind === "diagonal" || cell.kind === "empty") {
    return <div className="w-full h-full" />;
  }
  const inner = (
    <div className="w-full h-full flex flex-col items-center justify-center text-center leading-tight">
      {cell.winnerShort && (
        <div className="font-mono font-bold text-[12px] text-ipl-ink">
          {cell.winnerShort}
        </div>
      )}
      <div
        className={
          "font-mono text-[10px] text-ipl-sub " + (cell.winnerShort ? "mt-0.5" : "")
        }
      >
        {cell.margin}
      </div>
    </div>
  );
  if (cell.cricsheetId != null) {
    return (
      <Link
        href={`/match/${cell.cricsheetId}`}
        className="block w-full h-full hover:brightness-95 transition"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

// Shared cell tints so the legend and the matrix stay in sync. Blue + orange
// is colorblind-safe (deuteranopia/protanopia) and avoids the win/loss
// emotional weight of red.
const CELL_BG = {
  homeWin: "rgba(56, 116, 203, 0.20)", // soft blue
  visitorWin: "rgba(232, 138, 38, 0.24)", // soft orange
  abandoned: "rgba(245, 200, 80, 0.30)", // pale amber
  diagonal: "rgba(160, 158, 150, 0.30)",
  empty: "rgba(160, 158, 150, 0.10)",
};

function Legend() {
  const items: { label: string; bg: string }[] = [
    { label: "Home team won", bg: CELL_BG.homeWin },
    { label: "Visitor team won", bg: CELL_BG.visitorWin },
    { label: "Match abandoned", bg: CELL_BG.abandoned },
    { label: "Did not play", bg: CELL_BG.empty },
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3 px-1">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[10px] text-ipl-sub">
          <span
            className="inline-block w-3 h-3 rounded-sm border border-ipl-line"
            style={{ background: i.bg }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function PlayoffStrip({ playoffs }: { playoffs: MatchRow[] }) {
  const sorted = [...playoffs].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="flex-1 min-w-0 lg:pl-2">
      <div className="text-[10px] uppercase tracking-[0.06em] font-medium text-ipl-sub mb-2">
        Playoffs
      </div>
      <div className="flex flex-col gap-2">
        {sorted.map((m) => (
          <PlayoffCard
            key={m.cricsheet_match_id ?? `${m.match_stage}-${m.date}`}
            m={m}
          />
        ))}
      </div>
    </div>
  );
}

function PlayoffCard({ m }: { m: MatchRow }) {
  const stage = playoffStageLabel(m.match_stage);
  const winner = m.winner ?? "";
  const loser = winner ? (winner === m.team_1 ? m.team_2 : m.team_1) : "";
  const margin = formatMargin(m);
  const inner = (
    <div className="border border-ipl-line rounded-md px-3 py-2 leading-tight bg-ipl-bg2 hover:bg-ipl-bg2/70 transition">
      <div className="text-[10px] uppercase tracking-[0.06em] font-semibold text-ipl-sub">
        {stage}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[12px]">
        {winner ? (
          <>
            <TeamBadge team={winner} size={20} />
            <span className="font-semibold text-ipl-ink">{teamShort(winner)}</span>
            <span className="text-ipl-sub">beat</span>
            <TeamBadge team={loser} size={20} />
            <span className="text-ipl-ink">{teamShort(loser)}</span>
          </>
        ) : (
          <>
            <TeamBadge team={m.team_1} size={20} />
            <span>{teamShort(m.team_1)}</span>
            <span className="text-ipl-sub">vs</span>
            <TeamBadge team={m.team_2} size={20} />
            <span>{teamShort(m.team_2)}</span>
          </>
        )}
      </div>
      <div className="font-mono text-[10px] text-ipl-sub mt-1">{margin}</div>
    </div>
  );
  if (m.cricsheet_match_id != null) {
    return <Link href={`/match/${m.cricsheet_match_id}`}>{inner}</Link>;
  }
  return inner;
}

function buildResultCell(m: MatchRow, home: string, visitor: string): Cell {
  const result = (m.result ?? "").toLowerCase();
  if (result === "no result") {
    return {
      kind: "result",
      winnerShort: null,
      margin: "Match abandoned",
      homeWon: null,
      cricsheetId: m.cricsheet_match_id,
    };
  }
  const winner = m.winner ?? "";
  const homeWon = winner === home ? true : winner === visitor ? false : null;
  return {
    kind: "result",
    winnerShort: winner ? teamShort(winner) : null,
    margin: formatMargin(m),
    homeWon,
    cricsheetId: m.cricsheet_match_id,
  };
}

function formatMargin(m: MatchRow): string {
  const result = (m.result ?? "").toLowerCase();
  if (result === "no result") return "Match abandoned";
  if (result === "tie" && !m.winner) return "Tied";
  if (result === "tie" && m.winner) return "Super Over";
  if ((m.win_by_runs ?? 0) > 0)
    return `${m.win_by_runs} run${m.win_by_runs === 1 ? "" : "s"}`;
  if ((m.win_by_wickets ?? 0) > 0)
    return `${m.win_by_wickets} wicket${m.win_by_wickets === 1 ? "" : "s"}`;
  return "";
}

function playoffStageLabel(s: string | null): string {
  if (!s) return "";
  const n = s.trim().toLowerCase();
  if (n.startsWith("qualifier 1")) return "Qualifier 1";
  if (n.startsWith("qualifier 2")) return "Qualifier 2";
  if (n.startsWith("elimin")) return "Eliminator";
  if (n.startsWith("semi")) return "Semi Final";
  if (n.includes("3rd")) return "3rd Place";
  if (n === "final") return "Final";
  return s;
}

/** Per-team home venues for the season: any venue where the team played ≥3
 *  matches, capped at the team's top 2 most-frequent venues. Anything below
 *  the threshold is treated as neutral. */
function inferHomeVenues(
  matches: MatchRow[],
  teams: string[],
): Map<string, Set<string>> {
  const counts = new Map<string, Map<string, number>>();
  for (const t of teams) counts.set(t, new Map());
  for (const m of matches) {
    if ((m.match_stage ?? "league").toLowerCase() !== "league") continue;
    for (const t of [m.team_1, m.team_2]) {
      const byTeam = counts.get(t);
      if (!byTeam) continue;
      byTeam.set(m.venue, (byTeam.get(m.venue) ?? 0) + 1);
    }
  }
  const out = new Map<string, Set<string>>();
  for (const [t, byVenue] of counts.entries()) {
    const ranked = [...byVenue.entries()]
      .filter(([, c]) => c >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    out.set(t, new Set(ranked.map(([v]) => v)));
  }
  return out;
}

function pickHome(
  m: MatchRow,
  homeVenuesByTeam: Map<string, Set<string>>,
): string {
  const t1Home = homeVenuesByTeam.get(m.team_1)?.has(m.venue) ?? false;
  const t2Home = homeVenuesByTeam.get(m.team_2)?.has(m.venue) ?? false;
  if (t1Home && !t2Home) return m.team_1;
  if (t2Home && !t1Home) return m.team_2;
  // Both or neither claim the venue. Fall back to team_1 (batting-first proxy).
  return m.team_1;
}
