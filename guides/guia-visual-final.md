# ✅ Guia Visual amb Fletxes - Implementació Final

## 🎯 Objectiu
Crear una guia visual que aparegui **sobre la interfície existent** amb fletxes que apunten als botons reals per guiar l'usuari pas a pas en crear el seu primer accés.

## 📱 Implementació

### Nou Component: `OverlayGuideDialog`

He creat un nou diàleg d'overlay a `src/ui/overlay_guide.py` que:

1. **Es mostra sobre la interfície existent** (no un diàleg separat)
2. **Té fletxes visuals** que apunten als elements reals de la UI
3. **És semi-transparent** per veure el fons
4. **Té efectes visuals** (ombra i blur) per destacar-lo

### Característiques Clau:

```
┌─────────────────────────────────────────────────┐
│  🎯 Comença!                                    │
│  Prèst atenció al diagrama de dalt.             │
│  Segueix les fletxes per avançar.               │
│                                                  │
│  📍 Pass 1 de 5                                 │
│  ───────────────────────────────────────────    │
│  [Barra de progrés]                            │
│                                                  │
│  👉 → → → → → →                                │
│                                                  │
│  [◀ Anterior]         [Següent ▶]              │
└─────────────────────────────────────────────────┘
```

### Fletxes que apunten als botons reals:

```
┌─────────────────────────────────────────────────┐
│                                                  │
│  [Overlay Guide]                                │
│    ↓                                             │
│    ↓  👈 Fletxa apunta al botó                  │
│    ↓                                             │
│  ┌─────────────────┐                            │
│  │  Afegir accés   │ ← Botó real de la UI       │
│  └─────────────────┘                            │
│                                                  │
└─────────────────────────────────────────────────┘
```

## 🔄 Flux d'Usuari

### Seqüència Completa:

```
┌─────────────────────────────────────────────────┐
│                                                  │
│  1. Executar app (python main.py)                │
│     ↓                                            │
│  2. Crea nova caixa forta                        │
│     ↓                                            │
│  3. Introdueix contrasenya mestra                │
│     ↓                                            │
│  4. [NOU] Overlay Guide apareix                  │
│     │                                             │
│     │  - Mostra 5 passos amb fletxes             │
│     │  - Fletxes apunten al botó "Afegir accés"  │
│     │  - Navega amb ◀ Anterior / Següent ▶       │
│     │                                             │
│     ↓                                            │
│  5. L'usuari fa clic a "Següent" diverses vegades│
│     ↓                                            │
│  6. Finalitza la guia                            │
│     ↓                                            │
│  7. [NOU] Fletxa apunta al botó "Afegir accés"  │
│     ↓                                            │
│  8. L'usuari fa clic al botó                     │
│     ↓                                            │
│  9. S'obre el diàleg d'afegir                    │
│     ↓                                            │
│ 10. L'usuari omple les dades                     │
│     ↓                                            │
│ 11. Guarda l'entrada                             │
│                                                  │
└─────────────────────────────────────────────────┘
```

## 📂 Arxius Modificats

### 1. `src/ui/overlay_guide.py` (NOU)
```python
class OverlayGuideDialog(QDialog):
    """Overlay guide que es mostra sobre la UI existent."""
    
    - _init_ui(): Crea l'overlay amb fons semi-transparent
    - _find_afegir_button(): Troba el botó real "Afegir accés"
    - _draw_arrow_to_button(): Dibuixa fletxa cap al botó
    - _update_step(): Actualitza cada pas de la guia
```

### 2. `src/ui/main_window.py`
```python
# Import nou
from src.ui.overlay_guide import OverlayGuideDialog

# Ús nou
guide_dialog = OverlayGuideDialog(self, on_complete=self._on_guide_complete)
guide_dialog.exec()

# Mètode nou
def _on_guide_complete(self):
    """Callback quan la guia s'ha completat."""
    pass
```

## 🎨 Disseny Visual

### Colors:
- **Blau (#2563eb)**: Elements principals, fletxes, botons actius
- **Gris clar (#f1f5f9)**: Botons secundaris
- **Blanc amb transparència (rgba)**: Fons de l'overlay

### Efectes:
- **Ombra**: Per destacar l'overlay del fons
- **Blur suau**: Per difuminar el fons
- **Borda gruixuda**: Per delimitar clarament l'overlay

## ✅ Resultat Final

L'usuari veu:
1. ✅ Una guia **sobre la interfície** (no un diàleg separat)
2. ✅ **Fletxes visuals** que apunten als elements reals
3. ✅ Instruccions clares en **català**
4. ✅ Navegació fàcil amb **◀ Anterior** i **Següent ▶**
5. ✅ Una barra de progrés visual
6. ✅ No cal reintroduir la contrasenya

## 🧪 Com Provar-ho

```bash
# 1. Executa l'aplicació
python3 main.py

# 2. Crea una nova caixa forta amb una contrasenya segura
# 3. L'Overlay Guide apareix automàticament sobre la UI
# 4. Navega per les fletxes i finalitza
# 5. La fletxa apunta al botó "Afegir accés"
# 6. Fes clic al botó i omple les dades
```

## 📝 Notes

- La guia només es mostra **una vegada** quan la caixa forta està buida
- Si esborren totes les dades i comencen de nou, la guia es mostra de nou
- La guia detecta automàticament el botó "Afegir accés" a la UI
- Les fletxes es dibuixen dinàmicament cap al botó real
