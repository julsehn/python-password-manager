# Guia d'ús de SherLock

Aquesta guia explica el flux normal de l'aplicació d'escriptori: crear la caixa, afegir accessos, generar contrasenyes i configurar el núvol. Les captures no hi són perquè la interfície canvia sovint; els noms dels botons sí que es mantenen.

## La primera vegada

Quan obres l'aplicació i encara no hi ha cap caixa, veuràs la pantalla de benvinguda. Allà:

1. Escriu una contrasenya mestra. Al costat apareixen la força i la llista de requisits mentre escrius.
2. Repeteix-la al segon camp. Si no coincideixen, el formulari t'ho diu abans de continuar.
3. Prem **Crear la meva SherLock**.

La contrasenya ha de tenir 12 caràcters com a mínim, amb una majúscula, una minúscula, un número i un caràcter especial. El nucli de l'aplicació ho torna a comprovar i rebutja qualsevol contrasenya que no compleixi la política.

Si ja tens una còpia al núvol, el botó **Restaurar des del núvol (Railway)** és just sota el formulari. Et demanarà les credencials del compte i la contrasenya mestra per desxifrar el fitxer que baixa.

No hi ha manera de recuperar la contrasenya mestra. Si la perds, la caixa queda tancada per sempre. Val la pena exportar les entrades de tant en tant i guardar el fitxer en un lloc segur.

## Afegir un accés

El botó **Nou accés** és a la barra superior. Si la caixa és buida, també tens **Crear accés** al mig de la pantalla.

El formulari té aquests camps:

- **Nom de l'element**: obligatori. És el que veuràs a la llista, per exemple "YouTube".
- **Carpeta**: opcional, per classificar-lo.
- **Nom d'usuari**: el que fas servir per iniciar sessió.
- **Contrasenya**: obligatòria. El botó **Generar** obre el generador i hi enganxa el resultat.
- **Lloc web (URL)**: opcional, però és el que permet que l'extensió reconegui el domini i ompli el formulari.
- **Notes**: text lliure per a preguntes de seguretat, codis de recuperació o qualsevol altra cosa.

Desa amb **Guarda** o amb la marca de verificació de la cantonada superior dreta. Per editar un accés, obre'l i canvia el que calgui; el botó passa a ser **Desar canvis**.

## Carpetes

A la barra lateral tens **Tots els elements** i, a sota, les carpetes. El signe **+** en crea una de nova i el botó del llapis edita la que tinguis seleccionada. Es poden crear carpetes des del formulari d'un accés sense sortir-ne.

## Cercar

El camp **Cerca per lloc o usuari** filtra la llista mentre escrius. No busca dins de les notes ni a les contrasenyes, només al nom de l'element i al nom d'usuari.

## Generador

La pestanya **Generador** crea contrasenyes o frases. Pots triar la longitud, els símbols i l'idioma de les paraules, i el resultat es pot copiar o arrossegar a qualsevol camp de text. L'historial es guarda dins de la caixa, així que no queda res al disc sense xifrar.

## Configuració

### Seguretat

- **Temps de bloqueig automàtic**: per defecte, 15 minuts. També pots triar 5, 30 o mai. Qualsevol clic o tecla reinicia el comptador.
- **Canvia la contrasenya mestra**: rexifra la caixa sencera. Les entrades, carpetes, la paperera, l'historial i la sessió del núvol es conserven.

### Aparença i accessibilitat

Abans de crear la caixa, SherLock et demana el **tema** (clar, obscur o automàtic) i la **mida del text**. Ho pots canviar sempre que vulguis a **Configuració → Aparença**, entre 14 i 24 px, amb vista prèvia immediata. Els textos secundaris mantenen una mida mínima llegible i un contrast alt, també en mode fosc.

La mida del text se sincronitza amb l'extensió del navegador: si la canvies a l'app, l'extensió l'adopta en obrir-se; si la canvies a l'extensió, l'app l'adopta en tornar a tenir el focus. Cal tenir el native host instal·lat.

### Paperera

Els accessos eliminats no es perden: van a la **Paperera**, que s'obre amb la icona de la paperera de la capçalera de la llista d'accessos (mostra quants elements hi ha). Des d'allà els pots recuperar o esborrar definitivament.

Cada entrada de l'extensió té un **llapis** per editar-la i un botó de **copiar** amb dues opcions: copiar l'usuari o copiar la contrasenya. En clicar la targeta de l'entrada es mostren el lloc, l'usuari, la contrasenya i les notes.

### Emplenament des de l'extensió

- En clicar la icona de SherLock en un camp de login, si hi ha diversos accessos per al lloc apareix un menú per triar-ne un.
- Si l'accés triat està desat per a un altre domini del mateix lloc, l'extensió pregunta si vols **afegir aquest lloc i omplir** o **només omplir**.
- Si no hi ha cap accés per al lloc, pregunta si vols obrir l'extensió per **crear una entrada nova**. S'obre la pestanya **Desar** amb el lloc i l'usuari ja emplenats; només cal posar la contrasenya.
- Quan envies un formulari amb una contrasenya diferent de la desada, pregunta si vols **actualitzar** l'accés existent o **crear una entrada nova**. Si confirmes, es desa automàticament.

### Browsers vinculats

Cada navegador s'ha de vincular un cop. Prem **Generar codi per vincular un navegador** i escriu el codi a l'extensió. El codi dura dos minuts i només serveix una vegada. Si un navegador deixa de ser teu, revoca la vinculació des d'aquesta mateixa llista.

### Opcions de la caixa

- **Importar JSON / CSV**: accepta exportacions d'altres gestors. Revisa el resultat abans de confiar-hi.
- **Exportar**: baixa un JSON amb les entrades en text pla. L'aplicació t'avisa abans i té motiu: serveix per migrar o per fer una còpia de seguretat, però no el deixis en un lloc compartit.
- **Eliminar dades locals i començar de nou**: esborra la caixa d'aquest dispositiu. No toca el núvol.

### Sincronització amb Railway

Si connectes el compte, el botó **Sincronitzar** puja els canvis i baixa els que hagi fet un altre dispositiu. El servidor guarda el fitxer xifrat i la versió, res més.

En crear el compte de Railway, la contrasenya ha de complir els mateixos requisits de força que la mestra (12 caràcters, majúscula, minúscula, número i símbol). L'aplicació també t'avisa si escrius exactament la mateixa contrasenya mestra; la comprovació es fa dins del nucli de SherLock i la mestra no s'envia mai a la interfície.

- **Tancar sessió** revoca els testimonis al servidor. La còpia local es queda on és.
- **Eliminar compte i dades del núvol** esborra la caixa remota i el compte. La còpia local tampoc no es toca.

## Bloquejar i desbloquejar

El botó del cadenat, a dalt a la dreta, bloqueja la caixa immediatament. Per tornar-hi a entrar només cal la contrasenya mestra. No es desa enlloc i la còpia en memòria es neteja quan ja no cal.

## Si alguna cosa no funciona

- **L'extensió diu "disconnected"**: comprova que l'aplicació estigui oberta i que el navegador estigui vinculat. Si acabes de canviar de versió, torna a carregar l'extensió.
- **La sincronització falla amb un 401**: la sessió ha caducat. Tanca la sessió i torna a iniciar-la.
- **La sincronització falla amb un 409**: un altre dispositiu ha pujat una versió més nova. Baixa-la abans de tornar a pujar la teva.
- **Has oblidat la contrasenya mestra**: no hi ha recuperació possible. Si tens una exportació, encara pots obrir-la amb la contrasenya que hi correspongui.
