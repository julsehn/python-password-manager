# 📱 Guia Visual amb Fletxes - Pas a Pas

## 🎯 Objectiu
Mostrar als usuaris novells com crear el seu primer accés amb **fletxes visuals** que indiquin clarament el flux de treball.

## ✅ Implementació

### 1. Nou Diàleg de Guia: `StepByStepGuideDialog`

He creat un nou diàleg a `src/ui/tutorial_dialog.py` que mostra:

#### 📊 Diagrama de Flux Visual
```
┌─────────────────────────────────────────────┐
│  🏁 Començar →                               │
│  🌐 Omplir lloc web →                        │
│  👤 Omplir usuari →                          │
│  🔒 Omplir contrasenya →                     │
│  ✨ Confirmar →                              │
│  ✅ Finalitzar                               │
└─────────────────────────────────────────────┘
```

#### 📍 Indicador de Posició Actual
```
Pass 2 de 6: Lloc web
Introdueix el lloc web (ex: google.com). Ves al següent pas amb la fletxa.
📍 Pass 2
```

#### ⬅️ ➡️ Navegació amb Fletxes
```
◀ Anterior    Següent ▶
```

## 🎨 Característiques Visuals

### Arrows (Fletxes) Show:
1. **Diagrama de flux** amb emojis a cada pas
2. **Fletxa de posició** (📍) que mostra on ets
3. **Fletxes de navegació** (◀ ▶) per avançar/retrocedir
4. **Fletxes indicadors** (→) que s'actualitzen amb cada pas

### Colors:
- **Blau (#2563eb)**: Botons principals, elements actius
- **Gris clar (#f1f5f9)**: Botons secundaris
- **Verd (#16803c)**: Èxit
- **Taronja (#f59e0b)**: Atenció

## 📝 Exemple d'Ús

Quan l'usuari obre l'app per primera vegada:

```
┌─────────────────────────────────────────────────┐
│  🎯 Crea el teu primer accés                    │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │  🏁 Començar →                           │   │
│  │  🌐 Omplir lloc web →                    │   │
│  │  👤 Omplir usuari →                      │   │
│  │  🔒 Omplir contrasenya →                 │   │
│  │  ✨ Confirmar →                          │   │
│  │  ✅ Finalitzar                           │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
│  Pass 1 de 6: Començar                          │
│  Prèst atenció al diagrama de dalt amb les     │
│  fletxes. Estàs al principi del procés.        │
│                                                  │
│  🏁                                         │
│                                                  │
│  ◀ Anterior   Següent ▶                         │
└─────────────────────────────────────────────────┘
```

## 🔄 Flux Complet

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  1. L'usuari crea la caixa forta                 │
│     ↓                                            │
│  2. S'obre automàticament la guia                │
│     ↓                                            │
│  3. L'usuari navega per les fletxes              │
│     ↓                                            │
│  4. Finalment s'obre el diàleg d'afegir          │
│     ↓                                            │
│  5. L'usuari omple les dades                     │
│     ↓                                            │
│  6. La entrada es guarda                         │
│                                                  │
└──────────────────────────────────────────────────┘
```

## 📂 Arxius Modificats

1. **src/ui/tutorial_dialog.py** (NOU)
   - `FirstTimeGuideDialog`: Guia bàsica amb fletxes
   - `StepByStepGuideDialog`: Guia detallada amb diagrama de flux

2. **src/ui/main_window.py**
   - Importació actualitzada
   - Ús de `StepByStepGuideDialog` en lloc de `FirstTimeGuideDialog`

## 🚀 Com Provar-ho

```bash
# 1. Executa l'aplicació
python3 main.py

# 2. Crea una nova caixa forta
# 3. L'aplicació et mostrarà automàticament la guia
# 4. Navega amb les fletxes ◀ ▶
# 5. Finalment s'obrirà el diàleg d'afegir el primer accés
```

## 🎯 Resultat Final

L'usuari veu clarament:
- ✅ **On és** en el procés (📍 Pass X de Y)
- ✅ **Què ha de fer** (instruccions clares)
- ✅ **Com avançar** (fletxes visibles ◀ ▶)
- ✅ **El flux complet** (diagrama amb fletxes →)

Tota la interfície utilitza fletxes per guiar l'usuari pas a pas!
