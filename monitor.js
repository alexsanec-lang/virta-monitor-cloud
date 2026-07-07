import fs from "fs/promises";
import { sendNtfy } from "./ntfy.js";

const CONFIG = JSON.parse(
    await fs.readFile("config.json", "utf8")
);

async function loadState() {
    try {
        return JSON.parse(
            await fs.readFile("state.json", "utf8")
        );
    } catch {
        return {};
    }
}

async function saveState(state) {
    await fs.writeFile(
        "state.json",
        JSON.stringify(state, null, 2)
    );
}

function helsinkiTime(iso) {

    return new Date(iso).toLocaleString("fi-FI", {
        timeZone: "Europe/Helsinki",
        hour: "2-digit",
        minute: "2-digit"
    });

}
function formatDuration(since) {

    const seconds = Math.floor(
        (Date.now() - new Date(since).getTime()) / 1000
    );

    if (seconds < 60)
        return `${seconds} s`;

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60)
        return `${minutes} min`;

    const hours = Math.floor(minutes / 60);

    if (hours < 24)
        return `${hours} h ${minutes % 60} min`;

    const days = Math.floor(hours / 24);

    return `${days} d ${hours % 24} h`;

}

function connectorIcon(connector) {
    if (connector.available)
        return "🟢";
    if (connector.connectivityStatus === "Offline")
        return "⚫";
    if (connector.operativeStatus === "Faulted")
        return "⚫";
    return "🔴";
}
function connectorName(evse) {

    return (
        CONFIG.connectors[String(evse.id)] ??
        `EVSE ${evse.id}`
    );

}

async function readStation() {

    const response = await fetch(CONFIG.apiUrl);

    if (!response.ok)
        throw new Error(`HTTP ${response.status}`);

    const station = await response.json();

    const connectors = [];

    for (const evse of station.evses) {

        const connector = evse.connectors.find(c =>
            c.type === "Mennekes" ||
            c.type === "CCS"
        );

        if (!connector)
            continue;

        connectors.push({

            id: String(evse.id),

            name: connectorName(evse),

            type: connector.type,

            available: evse.available,

            operativeStatus: evse.operativeStatus,

            connectivityStatus: evse.connectivityStatus

        });

    }

    connectors.sort((a, b) => {

        const order = [
            "AC #1",
            "AC #2",
            "CCS #1",
            "CCS #2"
        ];

        return (
            order.indexOf(a.name) -
            order.indexOf(b.name)
        );

    });

    return connectors;

}

function compareState(previousState, connectors) {

    const newState = {};

    const changes = [];

    for (const connector of connectors) {

        const previous = previousState[connector.id];

        const current = {

            ...connector,

            since: new Date().toISOString()

        };

        if (previous) {

            if (previous.available === connector.available) {

                current.since = previous.since;

            } else {

                changes.push({

                    name: connector.name,

                    available: connector.available

                });

            }

        }

        newState[connector.id] = current;

    }

    return {

        newState,

        changes

    };

}
function buildMessage(connectors) {

    let message = "";

    for (const connector of connectors) {

        const icon = connectorIcon(connector);

        const duration = formatDuration(connector.since);

        let line = `${icon} ${connector.name.padEnd(7)} `;

        if (!connector.available) {

            line += connector.operativeStatus.padEnd(10) + " ";

        }

        line += duration;

        message += line + "\n";

    }

    return message.trim();

}

function printConsole(connectors) {

    console.log("");
    console.log(CONFIG.stationName);
    console.log("");

    for (const connector of connectors) {

        console.log(
            `${connectorIcon(connector)} ${connector.name.padEnd(7)} ` +
            `${connector.operativeStatus.padEnd(12)} ` +
            `${helsinkiTime(connector.since)}`
        );

    }

    console.log("");

}
async function main() {

    const previousState = await loadState();

    const connectors = await readStation();

    const {
        newState,
        changes
    } = compareState(previousState, connectors);

    // Restore the "since" timestamp into the connector list
    for (const connector of connectors) {
        connector.since = newState[connector.id].since;
    }

    printConsole(connectors);
    const force = process.argv.includes("--force");

    if (changes.length > 0 || force) {

        const message = buildMessage(connectors);

        console.log("");
        console.log("Sending ntfy...");
        console.log("");
        
        // const title =
        //     changes[0].available
        //     ? `${changes[0].name} became available`
        //     : `${changes[0].name} became occupied`;
        
        await sendNtfy(
            message,
            CONFIG.ntfyTopic
        );

    } else {

        console.log("No availability changes.");

    }

    await saveState(newState);

}

main().catch(err => {

    console.error("");
    console.error("Monitor failed");
    console.error(err);

    process.exit(1);

});