# Quick Start Guide

Aquest guide t'ajuda a posar en marxa ràpidament la gestió de contrasenyes amb sync a la núvol.

## Part 1: Instal·lació Ràpida

### 1. Clona el repositori

```bash
git clone https://github.com/julsehn/Password-Manager-Cloud.git
cd password-manager-cloud/python-password-manager
```

### 2. Crea un entorn virtual i installa

```bash
# Crea l'entorn virtual
python -m venv .venv

# Activa'l
source .venv/bin/activate  # Linux/Mac
# o:
# .venv\Scripts\activate  # Windows

# Installa les dependències
pip install -r requirements.txt
```

### 3. Executa l'aplicació

```bash
python main.py
```

## Part 2: Configurar el Servei a la Núvol

### Opció A: Desplegament Automàtic amb Railway (Recomanat)

1. **Sign in a Railway**: Vés a https://railway.app i sign in amb GitHub

2. **Crea un nou projecte**:
   - Fes clic en "New Project"
   - Crea un nou projecte anomenat "Password Manager"

3. **Connecta el repositori**:
   - Ves a "Sources" a Railway
   - Connecta GitHub i el repositori
   - Railway auto-desplegarà l'API

4. **Obtingues l'URL**:
   - Després del desplegament, afegeix `/.well-known` a l'URL
   - Ex: `https://your-project.up.railway.app/.well-known`

### Opció B: Utilitzar un Servei Existents

Si ja tens un servei Railway o API, assegura't que tingui aquests endpoints:
- `POST /v1/vaults` - Registrar caixa forta
- `GET /v1/vaults/{id}` - Descarregar
- `PUT /v1/vaults/{id}` - Actualitzar
- `DELETE /v1/vaults/{id}` - Eliminar

## Part 3: Configurar l'Aplicació

1. **Inicia l'aplicació**: `python main.py`

2. **Crea una nova caixa forta**:
   - L'aplicació et preguntarà per una contrasenya mestra
   - Trieu entre 16-64 caràcters per seguretat

3. **Configura el servei a la núvol**:
   - Ves a l'apartat "Configuració"
   - Introdueix l'URL del servei Railway
   - Crea una nova caixa forta núvol
   - Guarda les credencials

4. **Comprova la sync**:
   - Afegiu un accés a l'aplicació
   - Ves a "Remot" i descarrega la caixa forta
   - Heu d'obtenir l'accés des de la núvol!

## Part 4: Ús Diari

### Afegir un Nou Accés

1. Fes clic "Afegir accés"
2. Omple:
   - Nom del lloc web
   - Nom d'usuari
   - Contrasenya (mínim 8 caràcters)
   - Notes (opcional)
3. Guarda

### Copyar Contrasenya

1. Clica l'ús desitjat
2. Clica "Copia"
3. La contrasenya es copia al portapapers
4. Després de 30 segons, el portapapers s'esborra automàticament

### Sincronitzar

1. Ves al menú "Remot"
2. Clica "Descarrega la caixa forta" per obtenir canvis
3. Clica "Puja la caixa forta" per guardar canvis

## Configuració Avançada

### Portapapers Automàtic

Per canviar el temps que el portapapers s'esborra:

1. Ves a "Configuració"
2. Canvia "Segons per netejar el portapapers"
3. Guarda

### Bloqueig Automàtic

Per canviar el temps abans que el sistema es bloquegi:

1. Ves a "Configuració"
2. Canvia "Segons d'inactivitat per bloqueig automàtic"
3. Guarda (recomanat: 5 minuts)

## Solució de Problemes

### "Servei no configurat"
- Assegura't que l'URL del servidor és correcte
- Prova a cridar `curl https://el-teu-servici.up.railway.app`

### "Versió de conflicte"
- Això passa quan dues instàncies actualitzen alhora
- L'aplicació reprendrà automàticament amb la nova versió

### "No s'ha pogut descarregar"
- Verifica la connexió internet
- Assegura't que l'URL és accessible
- Prova a reiniciar l'aplicació

## Seguretat

- **Mai compartir la contrasenya mestra**
- **Backup regular**: Ves a "Configuració" i exportar una còpia de seguretat
- **Bloqueig automàtic**: Activeu el bloqueig per inactivitat
- **Llegat d'intents**: 10 intents fallits bloquegen la caixa forta

## Preguntes Freqüents

**Q: Puc utilitzar aquesta aplicació amb un altre servei?**
A: Sí! Només canvia l'URL al fitxer `~/.password_manager/config.json`

**Q: Les meves dades són privades?**
A: Sí! Totes les dades s'encifren al teu dispositiu abans de ser enviat al servei

**Q: Puc utilitzar-me sense internet?**
A: Sí! L'aplicació funciona completament sense connexió. La sync és opcional

**Q: Quina versió de Python necessito?**
A: Python 3.10 o superior
