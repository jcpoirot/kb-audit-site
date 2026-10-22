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
- Variable d'environnement `AUDIT_TOKEN` : jeton envoye dans l'en-tete `X-Audit-Token`, qui exempte l'audit
  de la regle anti-robots du WAF Azure Front Door (regle personnalisee `AllowSeoAudit`). Jamais dans le depot.
- Variable d'environnement `PROGRAMS_CSV_URL` : URL SAS en lecture seule de l'export marketing
  `programs.csv` (domaine `outilsmarketing.blob.core.windows.net` a autoriser). Le tirage au hasard ne porte
  que sur les programmes diffuses (publies B2C, actifs, sans parent). Jamais dans le depot ni dans le mail.
- Variable d'environnement `BREVO_API_KEY` : cle d'API Brevo utilisee par `npm run send`. Jamais dans le depot
  ni dans la sortie de la session. Domaine `api.brevo.com` a autoriser dans l'acces reseau.
- Droit de pousser sur la branche `main` du depot (les rapports servent de reference au lendemain).

## Deroulement

1. Lancer `npm run audit`. Il ecrit `reports/AAAA-MM-JJ.json` (date de Paris) et affiche un resume.
   - S'il echoue (code de sortie non nul) : lancer
     `npm run email -- --failure "<les 40 dernieres lignes de la sortie d'erreur>"`, envoyer le mail
     comme a l'etape 5 (sans `--text`), puis s'arreter.

2. Lire le rapport du jour : `alerts`, `diff`, `site`, et pour chaque page `score`, `counts`, `issues`.
   - Si le rapport contient `incomplete`, les pages de `incomplete.blockedSlots` ont recu une page de
     blocage du WAF : elles sont exclues du score et des comparaisons. Le dire dans le verdict, sans
     commenter leurs constats ; si `tokenSent` vaut false, preciser que `AUDIT_TOKEN` n'est pas defini.
   - Si le rapport contient `blocked` (aucune page lisible : proxy sortant ou WAF), ne pas ecrire
     de synthese : passer directement a l'etape 4, le mail genere explique deja le blocage.

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
   Ne modifier aucun autre fichier du depot. Si le push echoue, envoyer quand meme le mail et
   l'indiquer en tete de la version texte (les liens CSV / JSON du mail seront alors en 404).

5. Envoyer le mail via Brevo : `npm run send -- --text "<version texte courte : verdict de la synthese + lien vers le CSV>"`.
   Le script lit `reports/AAAA-MM-JJ.email.json` et envoie le HTML tel quel ; il reessaie deja une fois
   sur erreur reseau ou 5xx. N'utiliser aucun autre moyen d'envoi (pas de connecteur Gmail).
   Si le script echoue, recopier son message d'erreur dans la sortie de la session.
