# Política de privacitat de Password Manager Cloud

**Darrera actualització:** novembre de 2026

Aquesta política explica què passa amb les teves dades quan uses el servei oficial de Password Manager Cloud. Si fas servir un servidor propi, aquesta política no s'hi aplica: les dades les controla qui gestiona aquell servidor.

## Què guardem

Perquè el servei funcioni, al servidor hi ha:

- Les dades del compte: nom d'usuari, correu electrònic si l'has indicat, un hash Argon2id de la contrasenya del compte i la data de creació.
- La caixa xifrada: el fitxer que puja l'aplicació, la seva versió i la data de l'última actualització.
- Les sessions: un hash dels testimonis de refresc, la data de caducitat i si s'han revocat.

No guardem la contrasenya mestra, les contrasenyes desxifrades, les notes ni cap altre contingut de la caixa. El servidor rep la caixa ja xifrada i no pot desxifrar-la.

## Què no guardem

- La contrasenya mestra.
- El contingut desxifrat de la caixa.
- Adreces IP a la base de dades. Les fem servir de manera temporal, en memòria, per limitar intents d'accés repetits.
- Dades de navegació o estadístiques d'ús.

## Com es protegeix la caixa

L'aplicació xifra la caixa al teu dispositiu abans de pujar-la. Fa servir AES-256-GCM i deriva la clau de la contrasenya mestra amb Argon2id (64 MiB de memòria i 3 passades). El servidor només veu el resultat xifrat.

Això vol dir que, si algú accedeix a la base de dades del servidor, hi trobarà la caixa xifrada, però no les contrasenyes. La clau no surt mai del teu dispositiu.

## Qui pot accedir a la caixa

Només tu, amb la contrasenya mestra. Cada compte està aïllat: cada caixa pertany a un usuari i les consultes comproven la sessió i la propietat. L'equip del servei no pot desxifrar les caixes dels usuaris.

## Sessions

En iniciar sessió, el servidor dona un testimoni d'accés de curta durada (uns 15 minuts) i un testimoni de refresc. El testimoni de refresc es guarda com un hash, no en text pla.

Quan tanques la sessió, es revoquen els testimonis de refresc del compte. Això vol dir que també es tancarà la sessió als altres dispositius on hagis iniciat sessió amb el mateix compte.

## Exportar i eliminar

Pots exportar les teves entrades des de l'aplicació quan vulguis. Aquesta exportació surt sense xifrar, així que val la pena guardar-la en un lloc segur. També pots eliminar el compte i les dades del núvol des de la configuració de l'aplicació. En fer-ho, s'eliminen la caixa i les dades de sessió del servidor.

La còpia local no es toca si tanques la sessió o elimines el compte del núvol.

## Si oblides la contrasenya mestra

No la podem recuperar. No la guardem enlloc i no hi ha cap porta del darrere. Si la perds, la caixa xifrada no es pot obrir. Aquesta és una conseqüència directa del fet que el servei no tingui la clau.

## Canvis en aquesta política

Si canvia alguna cosa important, actualitzarem aquest document i la data de dalt. La versió que es mostra dins l'aplicació és una còpia d'aquest document.

## Contacte

Si tens dubtes o vols reportar un problema de privacitat, obre una incidència al repositori de Password Manager Cloud.
