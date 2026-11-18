/**
 * Loob repos sildid, verstapostid (milestones) ja issued failidest `issued/*.md`.
 *
 * Käivitub GitHub Actionsis ("Seadista issued"), aga töötab ka käsitsi:
 *   GH_TOKEN=... REPO=kasutaja/repo node .github/seadistus/seadista-issued.mjs
 *   KUIVKATSE=1 node .github/seadistus/seadista-issued.mjs   (ainult näitab, mida teeks)
 *
 * Võib käivitada mitu korda: olemasolevaid silte, verstaposte ja sama pealkirjaga issuesid ei looda uuesti.
 */
import {readdir, readFile} from "node:fs/promises";
import path from "node:path";

const KAUST = import.meta.dirname;
const TOKEN = process.env.GH_TOKEN;
const REPO = process.env.REPO;
const KUIVKATSE = process.env.KUIVKATSE === "1";
const API = "https://api.github.com";

function log(tekst) {
    process.stdout.write(`${tekst}\n`);
}

const oota = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Väike GitHub REST API abiline (fetch on Node'is sisseehitatud). */
async function gh(meetod, aadress, keha) {
    for (let katse = 1; ; katse++) {
        const vastus = await fetch(`${API}${aadress}`, {
            method: meetod,
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            ...(keha && {body: JSON.stringify(keha)}),
        });
        // GitHub piirab sisu loomise kiirust: ootame ja proovime uuesti.
        if ((vastus.status === 403 || vastus.status === 429) && katse < 5) {
            const sekundid = Number(vastus.headers.get("retry-after")) || 60;
            log(`  GitHub palub oodata ${sekundid} s...`);
            await oota(sekundid * 1000);
            continue;
        }
        if (!vastus.ok) {
            throw new Error(`${meetod} ${aadress} → ${vastus.status}: ${await vastus.text()}`);
        }
        return vastus.status === 204 ? null : vastus.json();
    }
}

/** Loeb kõik leheküljed (GitHub annab korraga kuni 100). */
async function koik(aadress) {
    const tulemus = [];
    for (let leht = 1; ; leht++) {
        const osa = await gh("GET", `${aadress}${aadress.includes("?") ? "&" : "?"}per_page=100&page=${leht}`);
        tulemus.push(...osa);
        if (osa.length < 100) return tulemus;
    }
}

/** Faili algus `--- ... ---` (pealkiri, verstapost, sildid), ülejäänu on issue sisu. */
function loeIssue(sisu) {
    const vaste = sisu.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
    if (!vaste) throw new Error("Failil puudub --- päis ---");
    const pais = Object.fromEntries(
        vaste[1].split("\n").map((rida) => {
            const koht = rida.indexOf(":");
            return [rida.slice(0, koht).trim(), rida.slice(koht + 1).trim()];
        }),
    );
    return {
        title: pais.title,
        milestone: pais.milestone || null,
        labels: pais.labels ? pais.labels.split(",").map((silt) => silt.trim()) : [],
        pinned: pais.pinned === "true",
        body: vaste[2].trim(),
    };
}

async function main() {
    const sildid = JSON.parse(await readFile(path.join(KAUST, "sildid.json"), "utf8"));
    const verstapostid = JSON.parse(await readFile(path.join(KAUST, "verstapostid.json"), "utf8"));
    const failid = (await readdir(path.join(KAUST, "issued"))).filter((fail) => fail.endsWith(".md")).sort();
    const issued = [];
    for (const fail of failid) {
        issued.push({fail, ...loeIssue(await readFile(path.join(KAUST, "issued", fail), "utf8"))});
    }

    if (KUIVKATSE) {
        log(`${sildid.length} silti, ${verstapostid.length} verstaposti, ${issued.length} issue't:`);
        for (const issue of issued) log(`  ${issue.title}  [${issue.milestone ?? "-"}] ${issue.labels.join(", ")}`);
        return;
    }
    if (!TOKEN || !REPO) throw new Error("GH_TOKEN ja REPO on puudu");
    const repo = `/repos/${REPO}`;

    log("Sildid");
    const olemasSildid = new Set((await koik(`${repo}/labels`)).map((silt) => silt.name));
    for (const silt of sildid) {
        if (olemasSildid.has(silt.name)) continue;
        await gh("POST", `${repo}/labels`, silt);
        log(`  + ${silt.name}`);
    }

    log("Verstapostid");
    const verstapostiNr = new Map(
        (await koik(`${repo}/milestones?state=all`)).map((verstapost) => [verstapost.title, verstapost.number]),
    );
    for (const verstapost of verstapostid) {
        if (verstapostiNr.has(verstapost.title)) continue;
        const loodud = await gh("POST", `${repo}/milestones`, verstapost);
        verstapostiNr.set(loodud.title, loodud.number);
        log(`  + ${loodud.title}`);
    }

    log("Issued");
    // Pull requestid ja issued jagavad numbreid. Kui repos on juba midagi, ei lähe numbrid sammudega kokku.
    const olemas = await koik(`${repo}/issues?state=all`);
    const olemasPealkirjad = new Set(olemas.map((issue) => issue.title));
    const voorad = olemas.filter((issue) => !issued.some((uus) => uus.title === issue.title));
    if (voorad.length > 0) {
        log(`  HOIATUS: repos on juba ${voorad.length} muud issue't/PR-i, issue numbrid ei klapi sammude numbritega.`);
    }

    for (const issue of issued) {
        if (olemasPealkirjad.has(issue.title)) {
            log(`  = ${issue.title} (juba olemas)`);
            continue;
        }
        const loodud = await gh("POST", `${repo}/issues`, {
            title: issue.title,
            body: issue.body,
            labels: issue.labels,
            milestone: issue.milestone ? verstapostiNr.get(issue.milestone) : undefined,
        });
        log(`  + #${loodud.number} ${issue.title}`);
        if (issue.pinned) await kinnita(loodud.node_id);
        await oota(1500);
    }
    log("Valmis! Ava vahekaart Issues.");
}

/** Kinnitab issue repo Issues lehe ülaossa. Kui ei õnnestu, pole hullu. */
async function kinnita(nodeId) {
    try {
        await gh("POST", "/graphql", {
            query: "mutation($id: ID!) { pinIssue(input: {issueId: $id}) { issue { number } } }",
            variables: {id: nodeId},
        });
        log("    (kinnitatud Issues lehe ülaossa)");
    } catch {
        log("    (kinnitamine ei õnnestunud, kinnita käsitsi: issue → Pin issue)");
    }
}

main().catch((viga) => {
    process.stderr.write(`${viga.message}\n`);
    process.exit(1);
});
