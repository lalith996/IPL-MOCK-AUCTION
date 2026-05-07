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
        powerplays?: Array<{ from: number; to: number; type: string }>;
    };
    innings?: Array<{
        team: string;
        powerplays?: Array<{ from: number; to: number; type: string }>;
        overs: Array<{
            over: number;
            deliveries: Array<{
                batter: string;
                bowler: string;
                runs: { batter: number; total: number };
                wickets?: Array<{ player_out: string }>;
            }>;
        }>;
    }>;
}

interface PlayerStats {
    name: string;
    nationality: string;
    cricsheetId?: string;

    // Overall stats
    matches: number;
    innings: number;

    // Batting
    runs: number;
    ballsFaced: number;
    fours: number;
    sixes: number;
    highestScore: number;
    notOuts: number;

    // Bowling
    wickets: number;
    ballsBowled: number;
    runsConceded: number;
    maidens: number;

    // Specialist metrics
    powerplayBatting: { runs: number; balls: number; fours: number; sixes: number };
    middleOverBatting: { runs: number; balls: number };
    deathBatting: { runs: number; balls: number; fours: number; sixes: number };

    powerplayBowling: { wickets: number; balls: number; runs: number };
    middleOverBowling: { wickets: number; balls: number; runs: number };
    deathBowling: { wickets: number; balls: number; runs: number };

    // Recent form (last 10 matches)
    recentMatches: Array<{
        date: string;
        runs: number;
        wickets: number;
        venue: string;
    }>;

    // Venue-specific
    venueStats: Map<string, { matches: number; runs: number; wickets: number }>;

    // Match type specific
    t20Stats: { matches: number; runs: number; wickets: number };
    iplStats: { matches: number; runs: number; wickets: number };
}

const seedIPL2026Players = async () => {
    try {
        console.log('🏏 Starting IPL 2026 Player Database Creation...\n');
        await connectDB();

        console.log('🧹 Clearing existing players...');
        await Player.deleteMany({});
        console.log('✅ Cleared\n');

        const jsonDirs = [
            { path: 'ipl_json', weight: 2.0, type: 'IPL' },
            { path: 't20s_male_json', weight: 1.5, type: 'T20' },
            { path: 'all_male_json', weight: 1.0, type: 'ALL' },
        ];

        const playersStatsMap = new Map<string, PlayerStats>();

        // Initialize all IPL 2026 players
        IPL_2026_PLAYERS.forEach(player => {
            playersStatsMap.set(player.name, {
                name: player.name,
                nationality: player.nationality,
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
                powerplayBatting: { runs: 0, balls: 0, fours: 0, sixes: 0 },
                middleOverBatting: { runs: 0, balls: 0 },
                deathBatting: { runs: 0, balls: 0, fours: 0, sixes: 0 },
                powerplayBowling: { wickets: 0, balls: 0, runs: 0 },
                middleOverBowling: { wickets: 0, balls: 0, runs: 0 },
                deathBowling: { wickets: 0, balls: 0, runs: 0 },
                recentMatches: [],
                venueStats: new Map(),
                t20Stats: { matches: 0, runs: 0, wickets: 0 },
                iplStats: { matches: 0, runs: 0, wickets: 0 },
            });
        });

        console.log(`📊 Processing ${IPL_2026_PLAYERS.length} IPL 2026 players from match data...\n`);

        let totalFilesProcessed = 0;

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

                    processMatchForIPLPlayers(
                        matchData,
                        playersStatsMap,
                        file,
                        dirInfo.type,
                        dirInfo.weight
                    );

                    totalFilesProcessed++;

                    if (totalFilesProcessed % 500 === 0) {
                        console.log(`   Processed ${totalFilesProcessed} matches...`);
                    }
                } catch (error) {
                    // Skip files with errors
                    continue;
                }
            }
        }

        console.log(`\n✅ Processed ${totalFilesProcessed} match files`);

        // Convert to Player documents
        const players = Array.from(playersStatsMap.values())
            .filter(p => p.matches > 0) // Only include players found in matches
            .map(playerStats => {
                const role = determineRole(playerStats);
                const calculatedStats = calculateDetailedStats(playerStats);

                return {
                    name: playerStats.name,
                    role: role,
                    stats: calculatedStats,
                    basePrice: calculateBasePrice(calculatedStats, role, playerStats.nationality),
                    cricsheetId: playerStats.cricsheetId || playerStats.name.replace(/\s+/g, '_'),
                    isSold: false,
                    formScore: calculateFormScore(playerStats),
                    buzzScore: calculateBuzzScore(playerStats),
                    valueScore: calculateValueScore(calculatedStats, role),
                    tier: determineTier(calculatedStats, role, playerStats),
                    nationality: playerStats.nationality,
                    isOverseas: playerStats.nationality !== 'India',

                    // Advanced metrics
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

        console.log(`\n💾 Inserting ${players.length} players into MongoDB...`);
        await Player.insertMany(players);

        // Print summary
        console.log('\n' + '='.repeat(80));
        console.log('📋 IPL 2026 PLAYER DATABASE SUMMARY\n');

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

        console.log('\nTop 10 Death Bowlers:');
        players
            .sort((a, b) => b.specialistRatings.deathBowler - a.specialistRatings.deathBowler)
            .slice(0, 10)
            .forEach((p, i) => {
                console.log(`   ${i + 1}. ${p.name.padEnd(25)} - Index: ${p.specialistRatings.deathBowler.toFixed(1)}`);
            });

        console.log('\nTop 10 Powerplay Batters:');
        players
            .sort((a, b) => b.specialistRatings.powerplayBatter - a.specialistRatings.powerplayBatter)
            .slice(0, 10)
            .forEach((p, i) => {
                console.log(`   ${i + 1}. ${p.name.padEnd(25)} - Index: ${p.specialistRatings.powerplayBatter.toFixed(1)}`);
            });

        console.log('\n' + '='.repeat(80));
        console.log(`\n✅ Successfully created IPL 2026 player database with ${players.length} players!`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

function processMatchForIPLPlayers(
    matchData: CricsheetMatch,
    playersMap: Map<string, PlayerStats>,
    fileName: string,
    matchType: string,
    weight: number
) {
    const registry = matchData.info?.registry?.people || {};
    const teams = matchData.info?.players || {};
    const matchDate = matchData.info?.dates?.[0] || '';
    const venue = matchData.info?.venue || matchData.info?.city || 'Unknown';
    const isIPL = matchData.info?.event?.name?.toLowerCase().includes('indian premier league');
    const isT20 = matchData.info?.match_type === 'T20' || matchType === 'T20';

    // Track players in this match
    const playersInMatch = new Set<string>();

    // Register all players
    for (const [teamName, playerNames] of Object.entries(teams)) {
        for (const playerName of playerNames) {
            if (playersMap.has(playerName)) {
                const cricsheetId = registry[playerName];
                const playerStats = playersMap.get(playerName)!;
                playerStats.cricsheetId = cricsheetId || playerStats.cricsheetId;
                playersInMatch.add(playerName);
            }
        }
    }

    // Process innings
    if (matchData.innings) {
        const matchBattingStats = new Map<string, { runs: number; balls: number; fours: number; sixes: number; highScore: number }>();
        const matchBowlingStats = new Map<string, { wickets: number; balls: number; runs: number }>();

        for (const inning of matchData.innings) {
            for (const over of inning.overs || []) {
                const overNumber = over.over;
                const phase = getPhase(overNumber);

                for (const delivery of over.deliveries || []) {
                    const batterName = delivery.batter;
                    const bowlerName = delivery.bowler;

                    // Batting stats
                    if (playersMap.has(batterName)) {
                        const playerStats = playersMap.get(batterName)!;
                        playerStats.runs += delivery.runs.batter;
                        playerStats.ballsFaced += 1;

                        if (delivery.runs.batter === 4) playerStats.fours++;
                        if (delivery.runs.batter === 6) playerStats.sixes++;

                        // Phase-specific batting
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

                        // Match-specific tracking
                        if (!matchBattingStats.has(batterName)) {
                            matchBattingStats.set(batterName, { runs: 0, balls: 0, fours: 0, sixes: 0, highScore: 0 });
                        }
                        const matchStats = matchBattingStats.get(batterName)!;
                        matchStats.runs += delivery.runs.batter;
                        matchStats.balls += 1;
                        if (delivery.runs.batter === 4) matchStats.fours++;
                        if (delivery.runs.batter === 6) matchStats.sixes++;
                    }

                    // Bowling stats
                    if (playersMap.has(bowlerName)) {
                        const playerStats = playersMap.get(bowlerName)!;
                        playerStats.ballsBowled += 1;
                        playerStats.runsConceded += delivery.runs.total;

                        if (delivery.wickets && delivery.wickets.length > 0) {
                            playerStats.wickets += delivery.wickets.length;
                        }

                        // Phase-specific bowling
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

                        // Match-specific tracking
                        if (!matchBowlingStats.has(bowlerName)) {
                            matchBowlingStats.set(bowlerName, { wickets: 0, balls: 0, runs: 0 });
                        }
                        const matchStats = matchBowlingStats.get(bowlerName)!;
                        matchStats.balls += 1;
                        matchStats.runs += delivery.runs.total;
                        if (delivery.wickets) matchStats.wickets += delivery.wickets.length;
                    }
                }
            }
        }

        // Update match count and recent form
        playersInMatch.forEach(playerName => {
            const playerStats = playersMap.get(playerName)!;
            playerStats.matches += 1;

            const battingStats = matchBattingStats.get(playerName);
            const bowlingStats = matchBowlingStats.get(playerName);

            if (battingStats && battingStats.balls > 0) {
                playerStats.innings += 1;
                playerStats.highestScore = Math.max(playerStats.highestScore, battingStats.runs);
            }

            // Venue stats
            if (!playerStats.venueStats.has(venue)) {
                playerStats.venueStats.set(venue, { matches: 0, runs: 0, wickets: 0 });
            }
            const venueData = playerStats.venueStats.get(venue)!;
            venueData.matches += 1;
            if (battingStats) venueData.runs += battingStats.runs;
            if (bowlingStats) venueData.wickets += bowlingStats.wickets;

            // Match type stats
            if (isT20) {
                playerStats.t20Stats.matches += 1;
                if (battingStats) playerStats.t20Stats.runs += battingStats.runs;
                if (bowlingStats) playerStats.t20Stats.wickets += bowlingStats.wickets;
            }
            if (isIPL) {
                playerStats.iplStats.matches += 1;
                if (battingStats) playerStats.iplStats.runs += battingStats.runs;
                if (bowlingStats) playerStats.iplStats.wickets += bowlingStats.wickets;
            }

            // Recent form
            playerStats.recentMatches.push({
                date: matchDate,
                runs: battingStats?.runs || 0,
                wickets: bowlingStats?.wickets || 0,
                venue: venue,
            });

            // Keep only last 20 matches for performance
            if (playerStats.recentMatches.length > 20) {
                playerStats.recentMatches = playerStats.recentMatches.slice(-20);
            }
        });
    }
}

function getPhase(overNumber: number): 'powerplay' | 'middle' | 'death' {
    if (overNumber < 6) return 'powerplay';
    if (overNumber < 16) return 'middle';
    return 'death';
}

function determineRole(playerStats: PlayerStats): 'Batsman' | 'Bowler' | 'All-Rounder' | 'Wicketkeeper' {
    const hasSignificantBatting = playerStats.runs > 200 || playerStats.innings > 10;
    const hasSignificantBowling = playerStats.wickets > 10 || playerStats.ballsBowled > 120;

    // Wicketkeeper detection (simplified - would need external data for accuracy)
    const knownKeepers = ['MS Dhoni', 'KL Rahul', 'Rishabh Pant', 'Sanju Samson', 'Ishan Kishan',
                          'Quinton De Kock', 'Jos Buttler', 'Heinrich Klaasen', 'Nicholas Pooran'];
    if (knownKeepers.includes(playerStats.name)) return 'Wicketkeeper';

    if (hasSignificantBatting && hasSignificantBowling) return 'All-Rounder';
    if (hasSignificantBowling) return 'Bowler';
    return 'Batsman';
}

function calculateDetailedStats(playerStats: PlayerStats) {
    const average = playerStats.innings > 0 ? playerStats.runs / playerStats.innings : 0;
    const strikeRate = playerStats.ballsFaced > 0 ? (playerStats.runs / playerStats.ballsFaced) * 100 : 0;
    const economy = playerStats.ballsBowled > 0 ? (playerStats.runsConceded / playerStats.ballsBowled) * 6 : 0;
    const bowlingAverage = playerStats.wickets > 0 ? playerStats.runsConceded / playerStats.wickets : 0;
    const bowlingStrikeRate = playerStats.wickets > 0 ? playerStats.ballsBowled / playerStats.wickets : 0;

    return {
        matches: playerStats.matches,
        innings: playerStats.innings,
        runs: playerStats.runs,
        ballsFaced: playerStats.ballsFaced,
        average: Math.round(average * 100) / 100,
        strikeRate: Math.round(strikeRate * 100) / 100,
        hundreds: Math.floor(playerStats.highestScore / 100),
        fifties: Math.floor(playerStats.highestScore / 50),
        fours: playerStats.fours,
        sixes: playerStats.sixes,
        wickets: playerStats.wickets,
        economy: Math.round(economy * 100) / 100,
        bowlingAverage: Math.round(bowlingAverage * 100) / 100,
        bowlingStrikeRate: Math.round(bowlingStrikeRate * 100) / 100,
    };
}

function calculateDeathBowlingIndex(playerStats: PlayerStats): number {
    if (playerStats.deathBowling.balls < 30) return 0;

    const economy = (playerStats.deathBowling.runs / playerStats.deathBowling.balls) * 6;
    const wicketsPerMatch = playerStats.matches > 0 ? playerStats.deathBowling.wickets / playerStats.matches : 0;

    // Lower economy is better, more wickets is better
    const economyScore = Math.max(0, 100 - (economy * 8)); // 8.5 economy = ~30 score
    const wicketScore = wicketsPerMatch * 50;

    return Math.min(100, (economyScore * 0.6 + wicketScore * 0.4));
}

function calculatePowerplayBattingIndex(playerStats: PlayerStats): number {
    if (playerStats.powerplayBatting.balls < 30) return 0;

    const strikeRate = (playerStats.powerplayBatting.runs / playerStats.powerplayBatting.balls) * 100;
    const boundaryPercentage = ((playerStats.powerplayBatting.fours + playerStats.powerplayBatting.sixes) / playerStats.powerplayBatting.balls) * 100;

    const srScore = Math.min(100, strikeRate * 0.6); // 140+ SR = 84+ score
    const boundaryScore = boundaryPercentage * 2;

    return Math.min(100, (srScore * 0.7 + boundaryScore * 0.3));
}

function calculatePowerplayBowlingIndex(playerStats: PlayerStats): number {
    if (playerStats.powerplayBowling.balls < 30) return 0;

    const economy = (playerStats.powerplayBowling.runs / playerStats.powerplayBowling.balls) * 6;
    const wicketsPerMatch = playerStats.matches > 0 ? playerStats.powerplayBowling.wickets / playerStats.matches : 0;

    const economyScore = Math.max(0, 100 - (economy * 10));
    const wicketScore = wicketsPerMatch * 50;

    return Math.min(100, (economyScore * 0.6 + wicketScore * 0.4));
}

function calculateMiddleOrderIndex(playerStats: PlayerStats): number {
    if (playerStats.middleOverBatting.balls < 50) return 0;

    const strikeRate = (playerStats.middleOverBatting.runs / playerStats.middleOverBatting.balls) * 100;
    const consistency = playerStats.innings > 5 ? Math.min(100, (playerStats.innings * 10)) : 0;

    return Math.min(100, (strikeRate * 0.4 + consistency * 0.6));
}

function calculateFinisherIndex(playerStats: PlayerStats): number {
    if (playerStats.deathBatting.balls < 30) return 0;

    const strikeRate = (playerStats.deathBatting.runs / playerStats.deathBatting.balls) * 100;
    const boundaryPercentage = ((playerStats.deathBatting.fours + playerStats.deathBatting.sixes) / playerStats.deathBatting.balls) * 100;

    const srScore = Math.min(100, strikeRate * 0.5); // 160+ SR = 80 score
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
    // Based on recent performance and match impact
    const recentRuns = playerStats.recentMatches.slice(-5).reduce((sum, m) => sum + m.runs, 0);
    const recentWickets = playerStats.recentMatches.slice(-5).reduce((sum, m) => sum + m.wickets, 0);

    const iplImpact = playerStats.iplStats.matches > 0 ? 20 : 0;
    const recentImpact = Math.min(60, (recentRuns * 0.3) + (recentWickets * 5));
    const experienceBonus = Math.min(20, playerStats.matches * 0.5);

    return Math.round(Math.min(100, iplImpact + recentImpact + experienceBonus));
}

function calculateValueScore(stats: any, role: string): number {
    const runsScore = Math.min(40, stats.runs * 0.01);
    const wicketsScore = Math.min(40, stats.wickets * 0.5);
    const matchesScore = Math.min(20, stats.matches * 0.5);

    return Math.round(Math.min(100, runsScore + wicketsScore + matchesScore));
}

function calculateBasePrice(stats: any, role: string, nationality: string): number {
    let price = 20; // Base 20 lakhs

    // Stats contribution
    price += Math.min(stats.runs / 50, 100);
    price += Math.min(stats.wickets * 3, 80);
    price += Math.min(stats.matches * 2, 50);

    // Role multiplier
    if (role === 'All-Rounder') price *= 1.3;
    if (role === 'Wicketkeeper') price *= 1.2;

    // Overseas multiplier
    if (nationality !== 'India') price *= 1.5;

    // Strike rate bonus
    if (stats.strikeRate > 140) price += 50;
    if (stats.economy < 7.5 && stats.wickets > 20) price += 50;

    return Math.round(Math.min(price, 2000) * 10) / 10; // Max 20 crore
}

function determineTier(stats: any, role: string, playerStats: PlayerStats): string {
    const totalImpact = stats.runs + (stats.wickets * 25) + (stats.matches * 10);
    const iplExperience = playerStats.iplStats.matches;

    if (iplExperience > 30 && totalImpact > 4000) return 'Marquee';
    if (role === 'All-Rounder' && stats.runs > 1000 && stats.wickets > 30) return 'All-Rounder';
    if (role === 'Wicketkeeper') return 'Wicketkeeper';
    if (role === 'Bowler') return 'Bowler';
    if (role === 'Batsman') return 'Batter';
    return 'Uncapped';
}

// Run the script
seedIPL2026Players();
