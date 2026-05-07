import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';
import Player from '../models/Player';
import { connectDB } from '../config/db';
import { IPL_2026_PLAYERS } from '../data/ipl2026Players';

dotenv.config();

interface CricsheetMatch {
    info?: {
        dates?: string[];
        venue?: string;
        city?: string;
        event?: { name?: string };
        match_type?: string;
        registry?: { people?: { [key: string]: string } };
        players?: { [team: string]: string[] };
    };
    innings?: Array<{
        team: string;
        overs: Array<{
            over: number;
            deliveries: Array<{
                batter: string;
                bowler: string;
                runs: { batter: number; total: number };
                wickets?: Array<{ player_out: string; kind: string }>;
            }>;
        }>;
    }>;
}

interface FormatStats {
    matches: number;
    innings: number;
    runs: number;
    ballsFaced: number;
    fours: number;
    sixes: number;
    highestScore: number;
    notOuts: number;
    wickets: number;
    ballsBowled: number;
    runsConceded: number;
    maidens: number;
}

interface PlayerStats {
    name: string;
    fullName: string; // Store both full name and short name
    nationality: string;
    cricsheetId?: string;

    overall: FormatStats;
    test: FormatStats;
    odi: FormatStats;
    t20i: FormatStats;
    t20: FormatStats;
    ipl: FormatStats;

    powerplayBatting: { runs: number; balls: number; fours: number; sixes: number };
    middleOverBatting: { runs: number; balls: number };
    deathBatting: { runs: number; balls: number; fours: number; sixes: number };
    powerplayBowling: { wickets: number; balls: number; runs: number };
    middleOverBowling: { wickets: number; balls: number; runs: number };
    deathBowling: { wickets: number; balls: number; runs: number };

    recentMatches: Array<{
        date: string;
        runs: number;
        wickets: number;
        venue: string;
    }>;
}

// Build global name registry from all JSON files
const globalNameRegistry = new Map<string, { fullName: string; nationality: string }>();
const cricsheetIdToPlayer = new Map<string, string>();

const createEmptyFormatStats = (): FormatStats => ({
    matches: 0,
    innings: 0,
    runs: 0,
    ballsFaced: 0,
    fours: 0,
    sixes: 0,
    highestScore: 0,
    notOuts: 0,
    wickets: 0,
    ballsBowled: 0,
    runsConceded: 0,
    maidens: 0,
});

const buildGlobalNameRegistry = () => {
    console.log('📖 Building global name registry from IPL 2026 players...\n');

    // Create mapping for IPL 2026 players
    IPL_2026_PLAYERS.forEach(player => {
        // Store full name
        globalNameRegistry.set(player.name, {
            fullName: player.name,
            nationality: player.nationality
        });

        // Also create short name variations (e.g., "Virat Kohli" -> "V Kohli")
        const nameParts = player.name.split(' ');
        if (nameParts.length >= 2) {
            const shortName = nameParts[0][0] + ' ' + nameParts.slice(1).join(' ');
            globalNameRegistry.set(shortName, {
                fullName: player.name,
                nationality: player.nationality
            });
        }
    });

    console.log(`✅ Registry built with ${globalNameRegistry.size} name variations\n`);
};

const seedIPL2026PlayersV3 = async () => {
    try {
        console.log('🏏 IPL 2026 Player Database V3 - Enhanced Name Matching\n');
        await connectDB();

        console.log('🧹 Clearing existing players...');
        await Player.deleteMany({});
        console.log('✅ Cleared\n');

        buildGlobalNameRegistry();

        const jsonDirs = [
            { path: 'tests_male_json', format: 'test', type: 'Test' },
            { path: 'odis_male_json', format: 'odi', type: 'ODI' },
            { path: 'it20s_male_json', format: 't20i', type: 'T20I' },
            { path: 't20s_male_json', format: 't20', type: 'T20' },
            { path: 'ipl_json', format: 'ipl', type: 'IPL' },
        ];

        const playersStatsMap = new Map<string, PlayerStats>();

        // Initialize players with full names
        IPL_2026_PLAYERS.forEach(player => {
            playersStatsMap.set(player.name, {
                name: player.name,
                fullName: player.name,
                nationality: player.nationality,
                overall: createEmptyFormatStats(),
                test: createEmptyFormatStats(),
                odi: createEmptyFormatStats(),
                t20i: createEmptyFormatStats(),
                t20: createEmptyFormatStats(),
                ipl: createEmptyFormatStats(),
                powerplayBatting: { runs: 0, balls: 0, fours: 0, sixes: 0 },
                middleOverBatting: { runs: 0, balls: 0 },
                deathBatting: { runs: 0, balls: 0, fours: 0, sixes: 0 },
                powerplayBowling: { wickets: 0, balls: 0, runs: 0 },
                middleOverBowling: { wickets: 0, balls: 0, runs: 0 },
                deathBowling: { wickets: 0, balls: 0, runs: 0 },
                recentMatches: [],
            });
        });

        console.log(`📊 Processing ${IPL_2026_PLAYERS.length} IPL 2026 players...\n`);

        let totalFilesProcessed = 0;
        const playersFoundInMatches = new Set<string>();

        for (const dirInfo of jsonDirs) {
            const jsonDir = path.join(__dirname, '../../../', dirInfo.path);

            if (!fs.existsSync(jsonDir)) {
                console.log(`⚠️  Directory not found: ${dirInfo.path}, skipping...`);
                continue;
            }

            const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));
            console.log(`📁 Processing ${dirInfo.type} (${dirInfo.path}): ${files.length} files`);

            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(jsonDir, file), 'utf-8');
                    const matchData: CricsheetMatch = JSON.parse(content);

                    const foundPlayers = processMatchByFormat(
                        matchData,
                        playersStatsMap,
                        dirInfo.format,
                        dirInfo.type
                    );

                    foundPlayers.forEach(p => playersFoundInMatches.add(p));

                    totalFilesProcessed++;

                    if (totalFilesProcessed % 1000 === 0) {
                        console.log(`   Processed ${totalFilesProcessed} matches... (${playersFoundInMatches.size} unique players found)`);
                    }
                } catch (error) {
                    continue;
                }
            }

            console.log(`✅ Completed ${dirInfo.type} - Found ${playersFoundInMatches.size} players\n`);
        }

        console.log(`✅ Total matches processed: ${totalFilesProcessed}`);
        console.log(`✅ Total unique IPL 2026 players found: ${playersFoundInMatches.size}\n`);

        // Convert to Player documents
        const players = Array.from(playersStatsMap.values())
            .filter(p => p.overall.matches > 0)
            .map(playerStats => {
                const role = determineRole(playerStats);

                const overallStats = calculateDetailedStats(playerStats.overall);
                const testStats = calculateDetailedStats(playerStats.test);
                const odiStats = calculateDetailedStats(playerStats.odi);
                const t20iStats = calculateDetailedStats(playerStats.t20i);
                const t20Stats = calculateDetailedStats(playerStats.t20);
                const iplStats = calculateDetailedStats(playerStats.ipl);

                return {
                    name: playerStats.fullName,
                    role: role,
                    stats: overallStats,
                    testStats: testStats,
                    odiStats: odiStats,
                    t20iStats: t20iStats,
                    t20Stats: t20Stats,
                    iplStats: iplStats,
                    basePrice: calculateBasePrice(overallStats, iplStats, role, playerStats.nationality),
                    cricsheetId: playerStats.cricsheetId || playerStats.name.replace(/\s+/g, '_'),
                    isSold: false,
                    formScore: calculateFormScore(playerStats),
                    buzzScore: calculateBuzzScore(playerStats),
                    valueScore: calculateValueScore(overallStats, role),
                    tier: determineTier(overallStats, iplStats, role, playerStats),
                    nationality: playerStats.nationality,
                    isOverseas: playerStats.nationality !== 'India',

                    specialistRatings: {
                        deathBowler: calculateDeathBowlingIndex(playerStats),
                        powerplayBatter: calculatePowerplayBattingIndex(playerStats),
                        powerplayBowler: calculatePowerplayBowlingIndex(playerStats),
                        middleOrderAnchor: calculateMiddleOrderIndex(playerStats),
                        finisher: calculateFinisherIndex(playerStats),
                    },

                    recentForm: playerStats.recentMatches.slice(-10),
                };
            });

        console.log(`💾 Inserting ${players.length} players into MongoDB...`);
        await Player.insertMany(players);

        // Print summary
        printSummary(players, playersFoundInMatches);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

function processMatchByFormat(
    matchData: CricsheetMatch,
    playersMap: Map<string, PlayerStats>,
    format: string,
    matchType: string
): Set<string> {
    const registry = matchData.info?.registry?.people || {};
    const teams = matchData.info?.players || {};
    const matchDate = matchData.info?.dates?.[0] || '';
    const venue = matchData.info?.venue || matchData.info?.city || 'Unknown';
    const isT20Format = format === 't20' || format === 't20i' || format === 'ipl';

    const playersFoundInThisMatch = new Set<string>();

    // Process all players in the match
    for (const [teamName, playerNames] of Object.entries(teams)) {
        for (const cricsheetName of playerNames) {
            // Check if this player is in our IPL 2026 list
            const playerInfo = globalNameRegistry.get(cricsheetName);

            if (playerInfo) {
                const fullName = playerInfo.fullName;

                if (playersMap.has(fullName)) {
                    const playerStats = playersMap.get(fullName)!;
                    const cricsheetId = registry[cricsheetName];

                    if (cricsheetId) {
                        playerStats.cricsheetId = cricsheetId;
                        cricsheetIdToPlayer.set(cricsheetId, fullName);
                    }

                    playersFoundInThisMatch.add(fullName);
                }
            }
        }
    }

    // Process innings
    if (matchData.innings && playersFoundInThisMatch.size > 0) {
        const matchBattingStats = new Map<string, { runs: number; balls: number; fours: number; sixes: number }>();
        const matchBowlingStats = new Map<string, { wickets: number; balls: number; runs: number }>();

        for (const inning of matchData.innings) {
            for (const over of inning.overs || []) {
                const overNumber = over.over;
                const phase = getPhase(overNumber);

                for (const delivery of over.deliveries || []) {
                    const batterCricsheetName = delivery.batter;
                    const bowlerCricsheetName = delivery.bowler;

                    // Check if batter is in our list
                    const batterInfo = globalNameRegistry.get(batterCricsheetName);
                    if (batterInfo && playersMap.has(batterInfo.fullName)) {
                        const batterFullName = batterInfo.fullName;
                        const playerStats = playersMap.get(batterFullName)!;
                        const formatStats = getFormatStats(playerStats, format);

                        formatStats.runs += delivery.runs.batter;
                        formatStats.ballsFaced += 1;
                        playerStats.overall.runs += delivery.runs.batter;
                        playerStats.overall.ballsFaced += 1;

                        if (delivery.runs.batter === 4) {
                            formatStats.fours++;
                            playerStats.overall.fours++;
                        }
                        if (delivery.runs.batter === 6) {
                            formatStats.sixes++;
                            playerStats.overall.sixes++;
                        }

                        // Phase-specific (T20 formats only)
                        if (isT20Format) {
                            if (phase === 'powerplay') {
                                playerStats.powerplayBatting.runs += delivery.runs.batter;
                                playerStats.powerplayBatting.balls += 1;
                                if (delivery.runs.batter === 4) playerStats.powerplayBatting.fours++;
                                if (delivery.runs.batter === 6) playerStats.powerplayBatting.sixes++;
                            } else if (phase === 'middle') {
                                playerStats.middleOverBatting.runs += delivery.runs.batter;
                                playerStats.middleOverBatting.balls += 1;
                            } else if (phase === 'death') {
                                playerStats.deathBatting.runs += delivery.runs.batter;
                                playerStats.deathBatting.balls += 1;
                                if (delivery.runs.batter === 4) playerStats.deathBatting.fours++;
                                if (delivery.runs.batter === 6) playerStats.deathBatting.sixes++;
                            }
                        }

                        if (!matchBattingStats.has(batterFullName)) {
                            matchBattingStats.set(batterFullName, { runs: 0, balls: 0, fours: 0, sixes: 0 });
                        }
                        const matchStats = matchBattingStats.get(batterFullName)!;
                        matchStats.runs += delivery.runs.batter;
                        matchStats.balls += 1;
                        if (delivery.runs.batter === 4) matchStats.fours++;
                        if (delivery.runs.batter === 6) matchStats.sixes++;
                    }

                    // Check if bowler is in our list
                    const bowlerInfo = globalNameRegistry.get(bowlerCricsheetName);
                    if (bowlerInfo && playersMap.has(bowlerInfo.fullName)) {
                        const bowlerFullName = bowlerInfo.fullName;
                        const playerStats = playersMap.get(bowlerFullName)!;
                        const formatStats = getFormatStats(playerStats, format);

                        formatStats.ballsBowled += 1;
                        formatStats.runsConceded += delivery.runs.total;
                        playerStats.overall.ballsBowled += 1;
                        playerStats.overall.runsConceded += delivery.runs.total;

                        if (delivery.wickets && delivery.wickets.length > 0) {
                            formatStats.wickets += delivery.wickets.length;
                            playerStats.overall.wickets += delivery.wickets.length;
                        }

                        // Phase-specific (T20 formats only)
                        if (isT20Format) {
                            if (phase === 'powerplay') {
                                playerStats.powerplayBowling.balls += 1;
                                playerStats.powerplayBowling.runs += delivery.runs.total;
                                if (delivery.wickets) playerStats.powerplayBowling.wickets += delivery.wickets.length;
                            } else if (phase === 'middle') {
                                playerStats.middleOverBowling.balls += 1;
                                playerStats.middleOverBowling.runs += delivery.runs.total;
                                if (delivery.wickets) playerStats.middleOverBowling.wickets += delivery.wickets.length;
                            } else if (phase === 'death') {
                                playerStats.deathBowling.balls += 1;
                                playerStats.deathBowling.runs += delivery.runs.total;
                                if (delivery.wickets) playerStats.deathBowling.wickets += delivery.wickets.length;
                            }
                        }

                        if (!matchBowlingStats.has(bowlerFullName)) {
                            matchBowlingStats.set(bowlerFullName, { wickets: 0, balls: 0, runs: 0 });
                        }
                        const matchStats = matchBowlingStats.get(bowlerFullName)!;
                        matchStats.balls += 1;
                        matchStats.runs += delivery.runs.total;
                        if (delivery.wickets) matchStats.wickets += delivery.wickets.length;
                    }
                }
            }
        }

        // Update match counts
        playersFoundInThisMatch.forEach(fullName => {
            const playerStats = playersMap.get(fullName)!;
            const formatStats = getFormatStats(playerStats, format);

            formatStats.matches += 1;
            playerStats.overall.matches += 1;

            const battingStats = matchBattingStats.get(fullName);
            const bowlingStats = matchBowlingStats.get(fullName);

            if (battingStats && battingStats.balls > 0) {
                formatStats.innings += 1;
                playerStats.overall.innings += 1;
                formatStats.highestScore = Math.max(formatStats.highestScore, battingStats.runs);
                playerStats.overall.highestScore = Math.max(playerStats.overall.highestScore, battingStats.runs);
            }

            playerStats.recentMatches.push({
                date: matchDate,
                runs: battingStats?.runs || 0,
                wickets: bowlingStats?.wickets || 0,
                venue: venue,
            });

            if (playerStats.recentMatches.length > 20) {
                playerStats.recentMatches = playerStats.recentMatches.slice(-20);
            }
        });
    }

    return playersFoundInThisMatch;
}

function getFormatStats(playerStats: PlayerStats, format: string): FormatStats {
    switch (format) {
        case 'test': return playerStats.test;
        case 'odi': return playerStats.odi;
        case 't20i': return playerStats.t20i;
        case 't20': return playerStats.t20;
        case 'ipl': return playerStats.ipl;
        default: return playerStats.overall;
    }
}

function getPhase(overNumber: number): 'powerplay' | 'middle' | 'death' {
    if (overNumber < 6) return 'powerplay';
    if (overNumber < 16) return 'middle';
    return 'death';
}

function determineRole(playerStats: PlayerStats): 'Batsman' | 'Bowler' | 'All-Rounder' | 'Wicketkeeper' {
    const hasSignificantBatting = playerStats.overall.runs > 200 || playerStats.overall.innings > 10;
    const hasSignificantBowling = playerStats.overall.wickets > 10 || playerStats.overall.ballsBowled > 120;

    const knownKeepers = ['MS Dhoni', 'KL Rahul', 'Rishabh Pant', 'Sanju Samson', 'Ishan Kishan',
                          'Quinton de Kock', 'Jos Buttler', 'Heinrich Klaasen', 'Nicholas Pooran',
                          'Rahmanullah Gurbaz', 'Jitesh Sharma', 'Dhruv Jurel', 'Abhishek Porel'];
    if (knownKeepers.includes(playerStats.fullName)) return 'Wicketkeeper';

    if (hasSignificantBatting && hasSignificantBowling) return 'All-Rounder';
    if (hasSignificantBowling) return 'Bowler';
    return 'Batsman';
}

function calculateDetailedStats(formatStats: FormatStats) {
    const average = formatStats.innings > 0 ? formatStats.runs / formatStats.innings : 0;
    const strikeRate = formatStats.ballsFaced > 0 ? (formatStats.runs / formatStats.ballsFaced) * 100 : 0;
    const economy = formatStats.ballsBowled > 0 ? (formatStats.runsConceded / formatStats.ballsBowled) * 6 : 0;
    const bowlingAverage = formatStats.wickets > 0 ? formatStats.runsConceded / formatStats.wickets : 0;
    const bowlingStrikeRate = formatStats.wickets > 0 ? formatStats.ballsBowled / formatStats.wickets : 0;

    return {
        matches: formatStats.matches,
        innings: formatStats.innings,
        runs: formatStats.runs,
        ballsFaced: formatStats.ballsFaced,
        average: Math.round(average * 100) / 100,
        strikeRate: Math.round(strikeRate * 100) / 100,
        hundreds: Math.floor(formatStats.highestScore / 100),
        fifties: Math.floor(formatStats.highestScore / 50),
        fours: formatStats.fours,
        sixes: formatStats.sixes,
        wickets: formatStats.wickets,
        economy: Math.round(economy * 100) / 100,
        bowlingAverage: Math.round(bowlingAverage * 100) / 100,
        bowlingStrikeRate: Math.round(bowlingStrikeRate * 100) / 100,
    };
}

function calculateDeathBowlingIndex(playerStats: PlayerStats): number {
    if (playerStats.deathBowling.balls < 30) return 0;
    const economy = (playerStats.deathBowling.runs / playerStats.deathBowling.balls) * 6;
    const wicketsPerMatch = (playerStats.t20.matches + playerStats.ipl.matches) > 0
        ? playerStats.deathBowling.wickets / (playerStats.t20.matches + playerStats.ipl.matches) : 0;
    const economyScore = Math.max(0, 100 - (economy * 8));
    const wicketScore = wicketsPerMatch * 50;
    return Math.min(100, (economyScore * 0.6 + wicketScore * 0.4));
}

function calculatePowerplayBattingIndex(playerStats: PlayerStats): number {
    if (playerStats.powerplayBatting.balls < 30) return 0;
    const strikeRate = (playerStats.powerplayBatting.runs / playerStats.powerplayBatting.balls) * 100;
    const boundaryPercentage = ((playerStats.powerplayBatting.fours + playerStats.powerplayBatting.sixes) / playerStats.powerplayBatting.balls) * 100;
    const srScore = Math.min(100, strikeRate * 0.6);
    const boundaryScore = boundaryPercentage * 2;
    return Math.min(100, (srScore * 0.7 + boundaryScore * 0.3));
}

function calculatePowerplayBowlingIndex(playerStats: PlayerStats): number {
    if (playerStats.powerplayBowling.balls < 30) return 0;
    const economy = (playerStats.powerplayBowling.runs / playerStats.powerplayBowling.balls) * 6;
    const wicketsPerMatch = (playerStats.t20.matches + playerStats.ipl.matches) > 0
        ? playerStats.powerplayBowling.wickets / (playerStats.t20.matches + playerStats.ipl.matches) : 0;
    const economyScore = Math.max(0, 100 - (economy * 10));
    const wicketScore = wicketsPerMatch * 50;
    return Math.min(100, (economyScore * 0.6 + wicketScore * 0.4));
}

function calculateMiddleOrderIndex(playerStats: PlayerStats): number {
    if (playerStats.middleOverBatting.balls < 50) return 0;
    const strikeRate = (playerStats.middleOverBatting.runs / playerStats.middleOverBatting.balls) * 100;
    const consistency = playerStats.overall.innings > 5 ? Math.min(100, (playerStats.overall.innings * 10)) : 0;
    return Math.min(100, (strikeRate * 0.4 + consistency * 0.6));
}

function calculateFinisherIndex(playerStats: PlayerStats): number {
    if (playerStats.deathBatting.balls < 30) return 0;
    const strikeRate = (playerStats.deathBatting.runs / playerStats.deathBatting.balls) * 100;
    const boundaryPercentage = ((playerStats.deathBatting.fours + playerStats.deathBatting.sixes) / playerStats.deathBatting.balls) * 100;
    const srScore = Math.min(100, strikeRate * 0.5);
    const boundaryScore = boundaryPercentage * 2.5;
    return Math.min(100, (srScore * 0.7 + boundaryScore * 0.3));
}

function calculateFormScore(playerStats: PlayerStats): number {
    const last10 = playerStats.recentMatches.slice(-10);
    if (last10.length < 3) return 50;
    const totalRuns = last10.reduce((sum, m) => sum + m.runs, 0);
    const totalWickets = last10.reduce((sum, m) => sum + m.wickets, 0);
    const avgRuns = totalRuns / last10.length;
    const avgWickets = totalWickets / last10.length;
    const runsScore = Math.min(50, avgRuns * 1.5);
    const wicketsScore = Math.min(50, avgWickets * 15);
    return Math.round(Math.min(100, runsScore + wicketsScore));
}

function calculateBuzzScore(playerStats: PlayerStats): number {
    const recentRuns = playerStats.recentMatches.slice(-5).reduce((sum, m) => sum + m.runs, 0);
    const recentWickets = playerStats.recentMatches.slice(-5).reduce((sum, m) => sum + m.wickets, 0);
    const iplImpact = playerStats.ipl.matches > 0 ? 20 : 0;
    const recentImpact = Math.min(60, (recentRuns * 0.3) + (recentWickets * 5));
    const experienceBonus = Math.min(20, playerStats.overall.matches * 0.5);
    return Math.round(Math.min(100, iplImpact + recentImpact + experienceBonus));
}

function calculateValueScore(stats: any, role: string): number {
    const runsScore = Math.min(40, stats.runs * 0.01);
    const wicketsScore = Math.min(40, stats.wickets * 0.5);
    const matchesScore = Math.min(20, stats.matches * 0.5);
    return Math.round(Math.min(100, runsScore + wicketsScore + matchesScore));
}

function calculateBasePrice(overallStats: any, iplStats: any, role: string, nationality: string): number {
    let price = 20;

    price += Math.min(iplStats.runs / 30, 100);
    price += Math.min(iplStats.wickets * 4, 80);
    price += Math.min(overallStats.runs / 100, 80);
    price += Math.min(overallStats.wickets * 2, 60);
    price += Math.min(overallStats.matches * 1, 40);

    if (role === 'All-Rounder') price *= 1.3;
    if (role === 'Wicketkeeper') price *= 1.2;
    if (nationality !== 'India') price *= 1.5;

    if (overallStats.strikeRate > 140) price += 50;
    if (overallStats.economy < 7.5 && overallStats.wickets > 20) price += 50;

    return Math.round(Math.min(price, 2000) * 10) / 10;
}

function determineTier(overallStats: any, iplStats: any, role: string, playerStats: PlayerStats): string {
    const totalImpact = overallStats.runs + (overallStats.wickets * 25) + (overallStats.matches * 10);
    const iplExperience = iplStats.matches;

    if (iplExperience > 30 && totalImpact > 4000) return 'Marquee';
    if (role === 'All-Rounder' && overallStats.runs > 1000 && overallStats.wickets > 30) return 'All-Rounder';
    if (role === 'Wicketkeeper') return 'Wicketkeeper';
    if (role === 'Bowler') return 'Bowler';
    if (role === 'Batsman') return 'Batter';
    return 'Uncapped';
}

function printSummary(players: any[], playersFoundInMatches: Set<string>) {
    console.log('\n' + '='.repeat(80));
    console.log('📋 IPL 2026 PLAYER DATABASE SUMMARY (V3 - ENHANCED NAME MATCHING)\n');

    const byNationality: { [key: string]: number } = {};
    const byRole: { [key: string]: number } = {};

    players.forEach(p => {
        byNationality[p.nationality] = (byNationality[p.nationality] || 0) + 1;
        byRole[p.role] = (byRole[p.role] || 0) + 1;
    });

    console.log('By Nationality:');
    Object.entries(byNationality)
        .sort((a, b) => b[1] - a[1])
        .forEach(([nat, count]) => {
            console.log(`   ${nat}: ${count} players`);
        });

    console.log('\nBy Role:');
    Object.entries(byRole).forEach(([role, count]) => {
        console.log(`   ${role}: ${count} players`);
    });

    console.log('\nTop 5 Players by Overall Matches:');
    players.sort((a, b) => b.stats.matches - a.stats.matches)
        .slice(0, 5)
        .forEach((p, i) => {
            console.log(`   ${i + 1}. ${p.name.padEnd(25)} - ${p.stats.matches}M total`);
        });

    console.log('\nTop 5 IPL Run Scorers:');
    players.sort((a, b) => b.iplStats.runs - a.iplStats.runs)
        .slice(0, 5)
        .forEach((p, i) => {
            console.log(`   ${i + 1}. ${p.name.padEnd(25)} - ${p.iplStats.runs}R in ${p.iplStats.matches}M`);
        });

    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Database ready with ${players.length} players!`);
}

seedIPL2026PlayersV3();
