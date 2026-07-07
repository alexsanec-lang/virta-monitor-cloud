export async function sendNtfy(message, topic) {

    const response = await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: {
            "Priority": "default",
            "Tags": "electric_plug"
        },
        body: message
    });

    if (!response.ok)
        throw new Error(`ntfy failed: ${response.status}`);

    console.log("✓ ntfy notification sent");
}