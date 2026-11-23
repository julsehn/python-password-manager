# SherLock

Gestor de contrasenyes local per a Mac, Windows i Linux. L'aplicació és Tauri 2: Rust al darrere, Vite al davant. Les dades s'xifren al teu ordinador; si actives el núvol, el servidor només rep el fitxer xifrat i no el pot obrir.

## Què fa

- Xifra la caixa amb AES-256-GCM i deriva la clau de la contrasenya mestra amb Argon2id (64 MiB de memòria, 3 passades).
- Sincronitza amb l'API de Railway quan la vols tenir en més d'un dispositiu. El servidor no veu mai el contingut.
- Es bloqueja sola per inactivitat, 15 minuts per defecte, i esborra de memòria les dades sensibles amb `zeroize`.
- Extensió per a Chrome i Firefox que parla amb l'aplicació per missatgeria nativa, sense exposar res a la xarxa.
- Generador de contrasenyes i frases, carpetes, historial i paperera.

## Requisits

- Node.js 18 o superior.
- Rust i Cargo.
- Python 3.10 o superior, només per a l'host de missatgeria nativa de l'extensió.

Per generar una versió de macOS signada i notaritzada cal executar `npm run tauri:build:macos:release` amb `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY` i `APPLE_API_KEY_PATH` configurats. L'ordre s'atura si no troba una identitat de codi-signatura vàlida.

## Posar-lo en marxa

Des de la carpeta `python-password-manager`:

```bash
npm install
npm run tauri:dev
```

Aquesta ordre compila en perfil release i no omple `src-tauri/target/debug`. Si estàs tocant codi i vols recompilacions ràpides, `npm run tauri -- dev` genera el perfil de depuració, molt més gran. Per netejar només aquests artefactes: `cargo clean --profile dev --manifest-path src-tauri/Cargo.toml`.

En macOS també pots fer doble clic a `Obrir_SherLock.command`.

## Extensió del navegador

La compilació és opcional i deixa els paquets a punt per carregar-los en mode desenvolupador:

```bash
./browser-extension/build.sh
```

Després cal registrar l'host de missatgeria nativa amb `./tools/install_native_host.sh`. Els passos detallats, les rutes de registre i els errors habituals són a [browser-extension/README.md](browser-extension/README.md) i [browser-extension/NATIVE_MESSAGING.md](browser-extension/NATIVE_MESSAGING.md). Python només fa falta per executar aquest host.

## Núvol

La sincronització és opcional. Si la vols:

1. Desplega l'API de `Password-Manager-Cloud` a Railway.
2. A l'aplicació, ves a Configuració i indica l'URL del servei.
3. Crea un compte i puja la caixa.

Des d'aleshores pots pujar i baixar la caixa des de la mateixa pantalla de configuració. El fitxer `~/.password_manager/config.json` només el fan servir els mòduls Python antics; l'aplicació Tauri no el llegeix ni l'escriu.

## Estructura

```
python-password-manager/
├── src-tauri/            # backend Rust, comandes Tauri i servidor local
├── src-web/              # interfície Vite: main.js, vistes, diàlegs i estils
├── browser-extension/    # extensió de Chrome i Firefox, i host natiu
├── tools/                # instal·lació de l'host i scripts de proves
├── guides/               # guia d'usuari
└── README.md
```

## Seguretat

La contrasenya mestra és l'única manera d'entrar. No hi ha autenticació per imatge ni cap selector de mètode: si no hi ha caixa, l'aplicació et rep amb la pantalla de benvinguda, et demana la contrasenya dues vegades i comprova que compleixi aquests mínims abans de xifrar res:

- 12 caràcters com a mínim.
- Una majúscula, una minúscula, un número i un caràcter especial.

El backend torna a validar la contrasenya pel seu compte; la llista de requisits de la interfície només és el primer filtre. Canviar la contrasenya mestra rexifra la caixa existent i conserva entrades, carpetes, paperera, historial i la sessió del núvol.

Altres coses que val la pena saber:

- La clau surt sempre de la contrasenya mestra. No es desa enlloc i la còpia que viu en memòria es neteja quan ja no cal.
- El servidor del núvol rep la caixa xifrada i metadades del compte. No rep la contrasenya mestra i no pot desxifrar res.
- L'extensió no llegeix la caixa directament: demana les credencials a l'aplicació a través de l'host natiu.
- Si oblides la contrasenya mestra, la caixa no es pot recuperar. No hi ha porta del darrere.

Més detalls a [browser-extension/SECURITY.md](browser-extension/SECURITY.md) i a la política de privacitat que es mostra dins de l'aplicació.

## Enllaços

- [Codi de l'API al núvol](https://github.com/julsehn/Password-Manager-Cloud)

## Llicència

MIT. Pots usar-la, estudiar-la, modificar-la i redistribuir-la.
