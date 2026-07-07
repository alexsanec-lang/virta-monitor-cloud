import { sendNtfy } from "./ntfy.js";
import fs from "fs/promises";

const config = JSON.parse(
    await fs.readFile("config.json", "utf8")
);

let previousState = {};

try {
    previousState = JSON.parse(
        await fs.readFile("state.json", "utf8")
    );
} catch {
    previousState = {};
}

const response = await fetch(config.apiUrl);

if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const station = await response.json();

const newState = {};
const changes = [];

for (const evse of station.evses) {

    const connector = evse.connectors.find(c =>
        c.type === "Mennekes" || c.type === "CCS"
    );

    if (!connector)
        continue;

    const id = String(evse.id);

    const name =
        config.connectors[id] ??
        `EVSE ${id}`;

    const current = {
        name,
        type: connector.type,
        operativeStatus: evse.operativeStatus,
        connectivityStatus: evse.connectivityStatus,
        since: new Date().toLocaleString("sv-SE", {
            timeZone: "Europe/Helsinki"
        })
    };

    const previous = previousState[id];

    if (previous) {

        const wasAvailable = previous.operativeStatus === "Available";
        const isAvailable = current.operativeStatus === "Available";

        // Keep the original timestamp unless availability changed
        if (wasAvailable === isAvailable) {
            current.since = previous.since;
        } else {

            changes.push({
                name,
                becameAvailable: isAvailable,
                oldStatus: previous.operativeStatus,
                newStatus: current.operativeStatus
            });

        }
    }

    newState[id] = current;
}

await fs.writeFile(
    "state.json",
    JSON.stringify(newState, null, 2)
);

console.log("Current status");
console.log("====================");

for (const connector of Object.values(newState)) {
    console.log(
        `${connector.name.padEnd(8)} | ${connector.operativeStatus.padEnd(10)} | ${connector.connectivityStatus.padEnd(7)} | Since ${connector.since}`
    );
}

console.log("");

if (changes.length === 0) {
    console.log("No status changes.");
} else {

    console.log("Changes:");

    let message = "Change:\n";

    for (const change of changes) {
        if (change.becameAvailable) {
            message += `🟢 ${change.name} became AVAILABLE\n`;
        } else {
            message += `🔴 ${change.name} is no longer available\n`;
        }
    }

    message += "\nCurrent status:\n\n";

    let acAvailable = 0;
    let ccsAvailable = 0;

    for (const connector of Object.values(newState)) {

        const icon =
            connector.operativeStatus === "Available" ? "🟢" :
            connector.type === "CCS" ? "⚫" : "🔴";

        const since = new Date(connector.since).toLocaleString("fi-FI", {
            timeZone: "Europe/Helsinki",
            hour: "2-digit",
            minute: "2-digit"
        });

        message += `${icon} ${connector.name}  ${connector.operativeStatus}\n`;
        message += `   since ${since}\n\n`;

        if (connector.operativeStatus === "Available") {
            if (connector.type === "CCS")
                ccsAvailable++;
            else
                acAvailable++;
        }
    }

    message += `Available:\n`;
    message += `AC: ${acAvailable}/2\n`;
    message += `CCS: ${ccsAvailable}/2\n`;
    message += `Total: ${acAvailable + ccsAvailable}/4`;

    await sendNtfy(
        "Virta Monitor",
        message,
        config.ntfyTopic
    );
}