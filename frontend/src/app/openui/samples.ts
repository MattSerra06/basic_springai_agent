/*
 * One reply per family of components, written as the model writes them. The catalogue
 * page draws them, and the tests check that each one is a valid program: an example here
 * that the parser refuses is a component the model cannot use either.
 */
export interface Sample {
  title: string;
  /** What the family is for, in a sentence. */
  about: string;
  program: string;
}

export const samples: Sample[] = [
  {
    title: 'Tableau de bord',
    about:
      'Des données lues par l’interface elle-même : un filtre les recharge sans repasser par l’agent. Ici la source est simulée.',
    program: `root = Response([board])
$ticker = "Rivage"
$days = "7"
prices = Query("demo_prices", {ticker: $ticker, days: $days}, [{date: "", close: 0, volume: 0}])
quote = Query("demo_quote", {ticker: $ticker}, {close: 0, change: 0}, 60)
board = Panel([filters, kpis, Columns([[chart], [tbl]], [3, 2])], "Cours de " + $ticker)
filters = Stack([Chips("ticker", ["Rivage", "Sémaphore", "Estran"], $ticker), Chips("days", ["7", "14", "30"], $days)], "row", "m", "center", "between")
kpis = Metrics([{label: "Dernier cours", value: "" + @Round(quote.close, 2) + " €", detail: "" + @Round(quote.change, 2) + " %", trend: quote.change >= 0 ? "up" : "down"}, {label: "Plus haut", value: "" + @Round(@Max(prices.close), 2) + " €"}, {label: "Plus bas", value: "" + @Round(@Min(prices.close), 2) + " €"}, {label: "Volume moyen", value: "" + @Round(@Avg(prices.volume))}])
chart = LineChart(prices.date, [Series("Clôture", prices.close)], "Clôture sur " + $days + " jours", "€")
tbl = Table(["Date", "Clôture (€)", "Volume"], @Each(@Sort(prices, "date", "desc"), "p", [p.date, p.close, p.volume]))`,
  },
  {
    title: 'Calculatrice',
    about: 'Une mini-application : son état vit dans le navigateur, les touches le modifient.',
    program: `root = Response([calc])
$cur = 0
$acc = 0
$op = ""
res = $op == "+" ? $acc + $cur : $op == "-" ? $acc - $cur : $op == "×" ? $acc * $cur : $op == "÷" ? $acc / $cur : $cur
calc = Panel([screen, keys], "Calculatrice")
screen = Display($cur, $op == "" ? "" : "" + $acc + " " + $op)
keys = Grid([k7, k8, k9, kdiv, k4, k5, k6, kmul, k1, k2, k3, ksub, kc, k0, keq, kadd], 4, "s")
k7 = Button("7", Action([@Set($cur, $cur * 10 + 7)]), "secondary")
k8 = Button("8", Action([@Set($cur, $cur * 10 + 8)]), "secondary")
k9 = Button("9", Action([@Set($cur, $cur * 10 + 9)]), "secondary")
k4 = Button("4", Action([@Set($cur, $cur * 10 + 4)]), "secondary")
k5 = Button("5", Action([@Set($cur, $cur * 10 + 5)]), "secondary")
k6 = Button("6", Action([@Set($cur, $cur * 10 + 6)]), "secondary")
k1 = Button("1", Action([@Set($cur, $cur * 10 + 1)]), "secondary")
k2 = Button("2", Action([@Set($cur, $cur * 10 + 2)]), "secondary")
k3 = Button("3", Action([@Set($cur, $cur * 10 + 3)]), "secondary")
k0 = Button("0", Action([@Set($cur, $cur * 10)]), "secondary")
kadd = Button("+", Action([@Set($acc, res), @Set($op, "+"), @Set($cur, 0)]), "ghost")
ksub = Button("-", Action([@Set($acc, res), @Set($op, "-"), @Set($cur, 0)]), "ghost")
kmul = Button("×", Action([@Set($acc, res), @Set($op, "×"), @Set($cur, 0)]), "ghost")
kdiv = Button("÷", Action([@Set($acc, res), @Set($op, "÷"), @Set($cur, 0)]), "ghost")
keq = Button("=", Action([@Set($cur, res), @Set($op, ""), @Set($acc, 0)]), "primary")
kc = Button("C", Action([@Reset($cur, $acc, $op)]), "danger")`,
  },
  {
    title: 'Drum pad',
    about: 'Des touches qui sonnent et un compteur de frappes.',
    program: `root = Response([pad])
$hits = 0
$last = "—"
pad = Panel([head, pads, reset], "Drum pad")
head = Grid([Display($hits, "Frappes"), Display($last, "Dernier son")], 2)
pads = Grid([p1, p2, p3, p4, p5, p6], 3)
p1 = Button("Kick", Action([@Set($hits, $hits + 1), @Set($last, "Kick")]), "secondary", "l", "kick")
p2 = Button("Snare", Action([@Set($hits, $hits + 1), @Set($last, "Snare")]), "secondary", "l", "snare")
p3 = Button("Hi-hat", Action([@Set($hits, $hits + 1), @Set($last, "Hi-hat")]), "secondary", "l", "hat")
p4 = Button("Clap", Action([@Set($hits, $hits + 1), @Set($last, "Clap")]), "ghost", "l", "clap")
p5 = Button("Tom", Action([@Set($hits, $hits + 1), @Set($last, "Tom")]), "ghost", "l", "tom")
p6 = Button("Bip", Action([@Set($hits, $hits + 1), @Set($last, "Bip")]), "ghost", "l", "beep")
reset = Buttons([Button("Remettre à zéro", Action([@Reset($hits, $last)]), "danger", "s")])`,
  },
  {
    title: 'Minuteur',
    about: 'Un pomodoro : le temps passe dans le navigateur, la fin d’une phase lance la suivante.',
    program: `root = Response([app])
$phase = "Travail"
$rounds = 0
app = Panel([mode, $phase == "Travail" ? work : rest, bar], "Pomodoro")
mode = Chips("phase", ["Travail", "Pause"], $phase)
work = Timer(1500, "Concentration", false, Action([@Set($rounds, $rounds + 1), @Set($phase, "Pause")]))
rest = Timer(300, "Pause", false, Action([@Set($phase, "Travail")]))
bar = Progress($rounds, 4, "Sessions terminées : " + $rounds + " sur 4")`,
  },
  {
    title: 'Convertisseur',
    about: 'Des champs reliés à des variables : le résultat se recalcule à chaque frappe.',
    program: `root = Response([app])
$bill = 80
$tip = 15
$people = 2
$round = false
total = $bill * (1 + $tip / 100)
part = total / $people
app = Panel([fields, opts, out], "Partager l'addition")
fields = Grid([f1, f2, f3], 3)
f1 = FormControl("Addition (€)", Input("bill", "0", "number", null, $bill))
f2 = FormControl("Pourboire", Slider("tip", 0, 30, 1, 15, "%", $tip))
f3 = FormControl("Convives", Input("people", "1", "number", null, $people))
opts = Switch("round", "Arrondir à l'euro supérieur", $round)
out = Grid([Display(@Round(total, 2), "Total (€)"), $people > 1 ? Display($round ? @Ceil(part) : @Round(part, 2), "Par personne (€)") : null], 2)`,
  },
  {
    title: 'Lieux et carte',
    about: 'Une liste et une carte qui se répondent : un clic sur un lieu centre la carte dessus.',
    program: `root = Response([app])
$sel = 1
$filtre = "Tous"
app = Panel([filter, Stack([list, map], "row")], "Cafés autour du Vieux-Port")
filter = Chips("filtre", ["Tous", "Terrasse", "Wifi"], $filtre)
list = List([$filtre != "Wifi" ? c1 : null, c2, $filtre != "Terrasse" ? c3 : null])
c1 = ListItem("Café de l'Abbaye", "Terrasse, vue sur le port", Action([@Set($sel, 1)]))
c2 = ListItem("Deep Coffee", "Terrasse et wifi, torréfacteur", Action([@Set($sel, 2)]))
c3 = ListItem("Le Comptoir Dugommier", "Wifi, grande salle", Action([@Set($sel, 3)]))
map = Map([m1, m2, m3], null, false, $sel)
m1 = Marker("Café de l'Abbaye", 43.2903, 5.3652, "Terrasse, vue sur le port")
m2 = Marker("Deep Coffee", 43.2946, 5.3745, "Terrasse et wifi")
m3 = Marker("Le Comptoir Dugommier", 43.3005, 5.3828, "Wifi, grande salle")`,
  },
  {
    title: 'Liste à cocher',
    about: 'Une liste que l’on coche, complète et vide soi-même.',
    program: `root = Response([todo])
todo = Checklist(["Réserver le train", "Prévenir le voisin pour les plantes", "Charger la liseuse"], "Avant le départ", true)`,
  },
  {
    title: 'Page HTML',
    about:
      'Une page libre écrite par le modèle, isolée du reste de l’app, qui s’ouvre en plein écran.',
    program: `root = Response([say, view])
say = TextContent("Une maquette de page d'accueil, à ouvrir en plein écran.")
view = HtmlView("Atelier Rivage · maquette", "<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;grid-template-rows:auto 1fr auto;font:16px/1.5 system-ui,sans-serif;color:#1d2a2f;background:linear-gradient(160deg,#e8f3f1,#fbf6ea)}header{display:flex;justify-content:space-between;align-items:center;padding:20px 28px}header b{font-size:20px;letter-spacing:-.02em}nav{display:flex;gap:18px;font-size:14px;color:#4c6168}main{display:grid;place-content:center;gap:18px;padding:28px;text-align:center}h1{margin:0;font-size:clamp(32px,7vw,68px);line-height:1.02;letter-spacing:-.03em;max-width:14ch}p{margin:0 auto;max-width:44ch;color:#4c6168}button{justify-self:center;padding:12px 22px;border:0;border-radius:999px;background:#0f6b62;color:#fff;font:600 15px system-ui;cursor:pointer;transition:transform .15s}button:hover{transform:translateY(-2px)}#n{font-variant-numeric:tabular-nums}.wave{height:90px;width:100%;display:block}footer{padding:14px 28px;font-size:13px;color:#4c6168}</style>\\n<header><b>Atelier Rivage</b><nav><span>Séjours</span><span>Ateliers</span><span>Contact</span></nav></header>\\n<main><h1>Apprendre la voile, une marée à la fois</h1><p>Des stages de trois jours en petit groupe, au départ de Douarnenez.</p><button onclick='n.textContent=+n.textContent+1'>Je suis intéressé · <span id='n'>12</span></button></main>\\n<footer><svg class='wave' viewBox='0 0 600 90' preserveAspectRatio='none'><path d='M0 50 Q75 10 150 50 T300 50 T450 50 T600 50 V90 H0Z' fill='#0f6b62' opacity='.18'><animate attributeName='d' dur='6s' repeatCount='indefinite' values='M0 50 Q75 10 150 50 T300 50 T450 50 T600 50 V90 H0Z;M0 50 Q75 80 150 50 T300 50 T450 50 T600 50 V90 H0Z;M0 50 Q75 10 150 50 T300 50 T450 50 T600 50 V90 H0Z'/></path></svg>Maquette d'exemple</footer>", 440)`,
  },
  {
    title: 'Parcours en étapes',
    about: 'Un contenu par étape, précédent et suivant, la progression toujours visible.',
    program: `root = Response([path])
$pain = "Campagne"
$poids = 500
path = Wizard([s1, s2, s3, s4], "Recevoir la fiche", Action([@ToAssistant("Envoie-moi la fiche de ce pain")]))
s1 = WizardStep("Le pain", [TextContent("Quel pain voulez-vous faire ?"), Chips("pain", ["Campagne", "Complet", "Seigle"], $pain)])
s2 = WizardStep("La quantité", [FormControl("Farine", Slider("poids", 250, 1000, 50, 500, "g", $poids)), Metrics([{label: "Eau", value: "" + @Round($poids * 0.7) + " g"}, {label: "Sel", value: "" + @Round($poids * 0.02) + " g"}, {label: "Levain", value: "" + @Round($poids * 0.2) + " g"}])])
s3 = WizardStep("Le pétrissage", [TextContent("Pétrissez dix minutes, puis laissez reposer la pâte sous un linge."), Timer(600, "Pétrissage")])
s4 = WizardStep("La cuisson", [Callout("info", "Pain " + $pain + ", " + $poids + " g de farine", "Quarante minutes à 240 °C, dans une cocotte fermée."), Checklist(["Préchauffer le four", "Fariner la cocotte", "Inciser la pâte"], "Avant d'enfourner")])`,
  },
  {
    title: 'Carrousel',
    about: 'Des éléments de même nature que l’on fait défiler aux flèches, au clavier ou au doigt.',
    program: `root = Response([one, many])
one = Carousel([q1, q2, q3], "Ce qu'en disent les stagiaires")
q1 = Quote("En trois jours, j'ai appris à lire le vent mieux qu'en dix ans de plage.", "Nadia, stage de juin")
q2 = Quote("On barre dès la première heure. C'est sportif, et c'est ce qu'il faut.", "Thomas, stage d'août")
q3 = Quote("Le moniteur ne crie jamais. Rien que pour ça, je reviendrai.", "Lucie, stage de septembre")
many = Carousel([p1, p2, p3, p4, p5], "Les sorties de la semaine", 3)
p1 = Panel([Tags(["Lundi"]), TextContent("Tour de l'île Tristan, par petit temps.")], "Découverte", "paper")
p2 = Panel([Tags(["Mardi"]), TextContent("Bords de près jusqu'au cap de la Chèvre.")], "Technique", "paper")
p3 = Panel([Tags(["Mercredi"]), TextContent("Navigation à l'estime, sans instruments.")], "Carte et compas", "paper")
p4 = Panel([Tags(["Jeudi"]), TextContent("Départ à l'aube pour l'île de Sein.")], "La grande sortie", "accent")
p5 = Panel([Tags(["Vendredi"]), TextContent("Régate amicale entre les équipages.")], "Régate", "paper")`,
  },
  {
    title: 'Compositions',
    about:
      'Un bandeau en vedette, une colonne principale et sa colonne latérale, des panneaux de tons différents.',
    program: `root = Response([hero, cols])
hero = Hero("La baie de Douarnenez, plan d'eau d'école", "Abritée de la houle du large, ventée tous les après-midi : on y apprend vite.", "Bretagne · Finistère", "accent", Buttons([Button("Voir les dates", Action([@ToAssistant("Quelles sont les dates des stages ?")]), "primary"), Button("Comment venir", Action([@ToAssistant("Comment venir à Douarnenez ?")]), "secondary")]))
cols = Columns([[main1, main2], [side1, side2]], [2, 1])
main1 = Panel([TextContent("Le vent thermique se lève vers quatorze heures et tombe au coucher du soleil. Les matinées servent à la théorie et aux manœuvres de port."), Table(["Mois", "Vent moyen (nœuds)", "Eau (°C)"], [["Juin", 11, 15], ["Juillet", 12, 17], ["Août", 12, 18], ["Septembre", 13, 17]], "Cliquez sur un en-tête pour trier.")], "Les conditions", "paper")
main2 = Panel([Steps([Step("Matin", "Briefing météo, nœuds et réglages à quai."), Step("Après-midi", "Trois heures sur l'eau, par équipages de quatre.")])], "Une journée type")
side1 = Panel([Metrics([{label: "Par stage", value: "8"}, {label: "Bateaux", value: "2"}])], "En petit groupe", "wood")
side2 = Panel([KeyValues([{label: "Durée", value: "3 jours"}, {label: "Niveau", value: "Débutant"}]), TextContent("Le ciré est fourni.", "muted")], "En bref", "accent")`,
  },
  {
    title: 'Mises en page',
    about: 'Des panneaux, des colonnes et des rangées qui s’emboîtent.',
    program: `root = Response([dash])
dash = Panel([top, Grid([left, right], 2), Stack([Tags(["Mis à jour ce matin"]), Buttons([Button("Actualiser", Action([@ToAssistant("Actualise ce tableau de bord")]), "secondary", "s")])], "row", "m", "center", "between")], "Vol AF 1284 · Paris → Lisbonne")
top = Metrics([{label: "Départ", value: "14:05", detail: "à l'heure", trend: "up"}, {label: "Arrivée", value: "15:40", detail: "heure locale"}, {label: "Porte", value: "K42"}])
left = Panel([Progress(62, 100, "Trajet parcouru"), KeyValues([{label: "Altitude", value: "11 300 m"}, {label: "Vitesse", value: "840 km/h"}])], "En vol")
right = Panel([Timeline([{when: "14:05", title: "Décollage de Paris"}, {when: "15:10", title: "Début de descente"}, {when: "15:40", title: "Atterrissage"}])], "Étapes")`,
  },
  {
    title: 'Texte',
    about: 'La prose, les titres, les encadrés, les citations et le code.',
    program: `root = Response([lead, body, h, note, warn, quote, sep, code])
lead = TextContent("Un agent qui répond avec une interface plutôt qu'avec un mur de texte.", "lead")
body = TextContent("Le texte courant accepte le **gras**, l'*italique*, le ==surlignage==, le \`code\` et les [liens](https://angular.dev).\\n\\nUn second paragraphe suit une ligne vide.")
h = Heading("Ce qu'il faut retenir")
note = Callout("info", "Rendu en continu", "L'interface se construit pendant que la réponse arrive.")
warn = Callout("warning", "Sans filet", "Une erreur du modèle retire le bloc fautif ; le reste s'affiche.")
quote = Quote("La simplicité est la sophistication suprême.", "Attribué à Léonard de Vinci")
sep = Separator()
code = CodeBlock("bash", "npm run openui:prompt\\n.\\\\mvnw.cmd spring-boot:run")`,
  },
  {
    title: 'Liens et sources',
    about: 'Les pages à ouvrir, et les sources citées dans le texte.',
    program: `root = Response([t, links, tags], srcs)
t = TextContent("Angular 22 fonctionne sans zone.js par défaut [1], et Spring AI expose le modèle par un ChatClient [2].")
links = LinkCards([{title: "Documentation Angular", url: "https://angular.dev/overview", description: "Guides, référence et tutoriels."}, {title: "Spring AI", url: "https://docs.spring.io/spring-ai/reference/", description: "La référence du projet."}, {title: "OpenUI", url: "https://github.com/thesysdev/openui", description: "Le langage et ses moteurs de rendu."}])
tags = Tags(["Angular", "Spring AI", "OpenUI Lang"])
srcs = [{title: "Zoneless change detection", url: "https://angular.dev/guide/zoneless", publisher: "angular.dev"}, {title: "Chat Client API", url: "https://docs.spring.io/spring-ai/reference/api/chatclient.html"}]`,
  },
  {
    title: 'Données',
    about: 'Chiffres clés, tableaux et fiches.',
    program: `root = Response([kpis, tbl, facts])
kpis = Metrics([{label: "Chiffre d'affaires", value: "1,24 M€", detail: "+8 % sur un an", trend: "up"}, {label: "Clients actifs", value: "3 412", detail: "stable", trend: "flat"}, {label: "Délai moyen", value: "2,4 j", detail: "-0,6 j", trend: "down"}])
tbl = Table(["Offre", "Prix mensuel (€)", "Stockage", "Support"], [["Basique", 9, "100 Go", "E-mail"], ["Pro", 19, "1 To", "**Prioritaire**"], ["Équipe", 49, "5 To", "Dédié"]], "Tarifs indicatifs, hors taxes.")
facts = KeyValues([{label: "Siège", value: "Lyon"}, {label: "Création", value: "2019"}, {label: "Site", value: "[example.com](https://example.com)"}])`,
  },
  {
    title: 'Graphiques',
    about: 'Barres, courbes, aires, classements et répartitions.',
    program: `root = Response([bars, lines, area, rank, pie])
bars = BarChart(["T1", "T2", "T3", "T4"], [b1, b2], "Ventes par trimestre", "k€")
b1 = Series("2024", [120, 180, 150, 240])
b2 = Series("2025", [140, 170, 190, 265])
lines = LineChart(["Jan", "Fév", "Mar", "Avr", "Mai", "Juin"], [l1, l2, l3], "Visites mensuelles", "k")
l1 = Series("Site", [42, 48, 51, 49, 58, 64])
l2 = Series("Appli", [18, 22, 29, 35, 41, 52])
l3 = Series("Lettre", [9, 11, 10, 14, 13, 17])
area = AreaChart(["Lun", "Mar", "Mer", "Jeu", "Ven"], [a1], "Requêtes par jour", "k")
a1 = Series("Requêtes", [310, 420, 380, 510, 460])
rank = HorizontalBarChart(["Île-de-France", "Auvergne-Rhône-Alpes", "Occitanie", "Bretagne"], [38, 24, 17, 9], "Part des commandes", "%")
pie = PieChart([Slice("Abonnements", 620), Slice("Services", 280), Slice("Formation", 140), Slice("Autres", 60)], "Revenus par activité", "k€")`,
  },
  {
    title: 'Carte',
    about: 'Des lieux épinglés, reliés ou non par un itinéraire.',
    program: `root = Response([t, map])
t = TextContent("Trois étapes pour un week-end en Provence.")
map = Map([m1, m2, m3], "Itinéraire", true)
m1 = Marker("Avignon", 43.9493, 4.8055, "Le palais des Papes et le pont.")
m2 = Marker("Les Baux-de-Provence", 43.7439, 4.7953, "Le village perché et les Carrières des Lumières.")
m3 = Marker("Arles", 43.6766, 4.6278, "Les arènes et la vieille ville.")`,
  },
  {
    title: 'Listes',
    about: 'Listes, procédures et chronologies.',
    program: `root = Response([list, steps, time])
list = List([ListItem("Comparer les offres", "Tarifs, stockage et support.", Action([@ToAssistant("Compare les offres")])), ListItem("Estimer le budget", "Sur douze mois."), ListItem("Choisir une date")])
steps = Steps([Step("Installer", "Lancez \`npm install\` dans frontend/."), Step("Générer le prompt", "Le catalogue est transformé en prompt pour le backend."), Step("Démarrer", "Le backend, puis \`npm start\`.")])
time = Timeline([{when: "2019", title: "Création", text: "Trois associés, un bureau."}, {when: "2022", title: "Première levée"}, {when: "2025", title: "Ouverture à l'international", text: "Madrid et Milan."}])`,
  },
  {
    title: 'Cartes et boutons',
    about: 'Des options à comparer, des actions et des suggestions.',
    program: `root = Response([cards, btns, next])
cards = Cards([c1, c2, c3])
c1 = Card("Lisbonne", "Trois jours entre azulejos et miradouros.", null, "Ville", Button("Choisir Lisbonne", Action([@ToAssistant("Je choisis Lisbonne")]), "secondary"))
c2 = Card("Madère", "Randonnées sur les levadas, au-dessus de l'océan.", null, "Nature", Button("Choisir Madère", Action([@ToAssistant("Je choisis Madère")]), "secondary"))
c3 = Card("Porto", "Les chais, le Douro et la Ribeira.", null, "Ville", Button("Choisir Porto", Action([@ToAssistant("Je choisis Porto")]), "secondary"))
btns = Buttons([Button("Réserver", Action([@ToAssistant("Réserve ce voyage")]), "primary"), Button("Voir le guide", Action([@OpenUrl("https://www.visitportugal.com")]), "secondary")])
next = FollowUps(["Quel budget prévoir ?", "Quelle est la meilleure saison ?"])`,
  },
  {
    title: 'Formulaire',
    about: 'Plusieurs réponses demandées en une fois, avec validation.',
    program: `root = Response([ask, form])
ask = TextContent("Quelques précisions pour chiffrer le voyage.")
form = Form("trip", btns, [f1, f2, f3, f4, f5, f6, f7])
f1 = FormControl("Destination", Input("destination", "Lisbonne", "text", {required: true, minLength: 2}))
f2 = FormControl("E-mail", Input("email", "vous@exemple.fr", "email", {required: true, email: true}), "Pour recevoir le devis.")
f3 = FormControl("Départ", DatePicker("date", {required: true}))
f4 = FormControl("Budget", Slider("budget", 300, 3000, 100, 1200, "€"))
f5 = FormControl("Rythme", RadioGroup("rythme", [RadioItem("calme", "Tranquille", "Deux visites par jour"), RadioItem("dense", "Dense", "Du matin au soir")], "calme"))
f6 = FormControl("Envies", CheckBoxGroup("envies", [CheckBoxItem("musees", "Musées", null, true), CheckBoxItem("plages", "Plages"), CheckBoxItem("tables", "Bonnes tables")]))
f7 = FormControl("Hébergement", Select("logement", [SelectItem("hotel", "Hôtel"), SelectItem("appart", "Appartement"), SelectItem("auberge", "Auberge"), SelectItem("camping", "Camping"), SelectItem("autre", "Autre")], "Choisir…", {required: true}))
btns = Buttons([Button("Chiffrer le voyage", Action([@ToAssistant("Chiffre ce voyage")]), "primary"), Button("Plus tard", Action([@ToAssistant("On verra plus tard")]), "secondary")])`,
  },
  {
    title: 'Onglets et sections',
    about: 'Plusieurs vues du même sujet, et des détails repliés.',
    program: `root = Response([tabs, acc])
tabs = Tabs([t1, t2])
t1 = Tab("Résumé", [TextContent("L'offre Pro convient à une équipe de cinq."), Metrics([{label: "Coût annuel", value: "1 140 €"}, {label: "Par personne", value: "19 €/mois"}])])
t2 = Tab("Détail", [Table(["Poste", "Montant (€)"], [["Licences", 1140], ["Mise en place", 0]])])
acc = Accordion([AccordionItem("Hypothèses", [TextContent("Cinq utilisateurs, engagement annuel.")]), AccordionItem("Ce qui n'est pas compté", [List([ListItem("La formation"), ListItem("La migration des données")])])])`,
  },
];
