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
    title: 'Texte',
    about: 'La prose, les titres, les encadrés, les citations et le code.',
    program: `root = Response([lead, body, h, note, warn, quote, sep, code])
lead = TextContent("Un agent qui répond avec une interface plutôt qu'avec un mur de texte.", "lead")
body = TextContent("Le texte courant accepte le **gras**, l'*italique*, le \`code\` et les [liens](https://angular.dev).\\n\\nUn second paragraphe suit une ligne vide.")
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
