# Routine d'audit SEO (lundi et jeudi matin)

Prompt de la routine cloud Claude Code (`/schedule`). Il est versionne ici pour que la routine
et le depot evoluent ensemble : la routine se contente de lui demander de suivre ce fichier.

## Prompt a coller dans la routine

```
Suis exactement les instructions de ROUTINE.md (section « Deroulement ») pour l'audit du jour.
```

## Prerequis de la routine

- Node 20+ (aucune dependance npm a installer).
- Acces reseau autorise vers `www.kaufmanbroad.fr`.
- Connecteur **Gmail** active sur la routine (envoi depuis le compte de l'utilisateur).
- Droit de pousser sur la branche `main` du depot (les rapports servent de reference au lendemain).

## Deroulement

1. Lancer `npm run audit`. Il ecrit `reports/AAAA-MM-JJ.json` (date de Paris) et affiche un resume.
   - S'il echoue (code de sortie non nul) : lancer
     `npm run email -- --failure "<les 40 dernieres lignes de la sortie d'erreur>"`, envoyer le mail
     comme a l'etape 5, puis s'arreter.

2. Lire le rapport du jour : `alerts`, `diff`, `site`, et pour chaque page `score`, `counts`, `issues`.

3. Ecrire `reports/AAAA-MM-JJ.synthese.md`, en francais, 15 lignes maximum, en Markdown simple
   (titres `##`, listes `-`, gras `**`), dans cet ordre :
   - **Verdict** en une phrase : stable, amelioration ou regression, et pourquoi.
   - **Alertes** : chaque alerte expliquee en une ligne, avec l'impact SEO concret. Omettre si aucune.
   - **Changements** depuis le rapport precedent (`diff.previousDate`) sur les pages temoins et le site. Pour les pages tirees au
     hasard (`samePage: false`), ne pas presenter les ecarts comme des regressions : ce sont
     d'autres pages. Signaler en revanche un defaut nouveau qui n'apparait sur aucune page temoin.
   - **3 actions prioritaires** maximum, tirees des erreurs en cours.
   Regles : ne rien affirmer qui ne figure pas dans le rapport ; ne pas recopier les tableaux que
   le mail contient deja ; si un constat `http-blocked` est present, dire que l'audit a ete bloque
   et que les autres constats de la page ne sont pas fiables.

4. Lancer `npm run email`, puis commiter `reports/AAAA-MM-JJ.json`, `reports/AAAA-MM-JJ.csv` et
   `reports/AAAA-MM-JJ.synthese.md` (message : `audit: rapport du AAAA-MM-JJ`) et pousser sur `main`.
   Le mail contient des liens vers ces fichiers sur GitHub : le push doit preceder l'envoi.
   Ne modifier aucun autre fichier du depot.

5. Envoyer le mail avec l'outil Gmail `send_message` :
   - `to` et `subject` : ceux de `reports/AAAA-MM-JJ.email.json` ;
   - `htmlBody` : le contenu **integral et inchange** du fichier `htmlFile` ;
   - `body` : une version texte courte (verdict de la synthese + lien vers le CSV).
   En cas d'echec, reessayer une fois ; si l'echec persiste, le dire dans la sortie de la session.
