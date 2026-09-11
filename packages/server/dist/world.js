const walls = [];
// Border walls
for (let x = 0; x < 40; x++) {
    walls.push(`${x},0`);
    walls.push(`${x},29`);
}
for (let y = 0; y < 30; y++) {
    walls.push(`0,${y}`);
    walls.push(`39,${y}`);
}
// A couple of interior structure walls (meeting area dividers)
for (let y = 5; y < 12; y++)
    walls.push(`14,${y}`);
for (let y = 18, _ = 0; y < 24; y++)
    walls.push(`30,${y}`);
export const defaultMap = {
    name: "convention-floor",
    w: 40,
    h: 30,
    walls,
    zones: [
        {
            id: "main-stage",
            x: 15, y: 2, w: 10, h: 5,
            allowedRoles: ["admin", "speaker"],
            isStage: true,
            label: "Main Stage",
            mediaRef: "", // set per instance (DJ stream / video)
        },
        {
            id: "roundtable-1",
            x: 6, y: 14, w: 5, h: 4,
            allowedRoles: ["admin", "speaker", "panelist"],
            isStage: false,
            label: "Round Table 1",
            mediaRef: "",
        },
        {
            id: "lounge-dj",
            x: 26, y: 6, w: 8, h: 6,
            allowedRoles: ["admin", "speaker", "dj"],
            isStage: true,
            label: "DJ Lounge",
            mediaRef: "",
        },
    ],
};
