# ✅ Fixes Applied - Guia Visual amb Fletxes

## Problemes Detectats i Solucionats

### 1️⃣ Problema: La guia no apareixia a l'app
**Causa:** El codi feia referència a `FirstTimeGuideDialog` en lloc de `StepByStepGuideDialog`

**Solució:**
- Actualitzat la referència a `StepByStepGuideDialog` en `_initialize_new_vault()` (línia 364)
- Afecta quan es crea una nova caixa forta per primera vegada

### 2️⃣ Problema: Els usuaris havien de reintroduir la contrasenya
**Causa:** Quan l'usuari feia clic a "Afegir accés" després de la guia, el codi mostrava la guia de nou i intentava autenticar, però l'usuari ja estava autenticat

**Solució:**
- Afegit un flag `_showed_first_time_guide` per recordar si la guia ja s'ha mostrat
- Actualitzat `on_add()` per no mostrar la guia si ja s'ha mostrat abans
- La guia només es mostra una vegada quan la caixa forta està buida

## 📝 Canvis al Codi

### `src/ui/main_window.py`

#### 1. Nou atribut a `__init__`:
```python
self._showed_first_time_guide = False
```

#### 2. Actualitzat `_initialize_new_vault()`:
```python
# Show first-time guide with arrow navigation
guide_dialog = StepByStepGuideDialog(self)
guide_dialog.exec()
self._showed_first_time_guide = True  # ← Nou: marcar que la guia s'ha mostrat
```

#### 3. Actualitzat `on_add()`:
```python
# Show guide if vault is empty AND guide hasn't been shown yet (first-time user)
if not self.manager.get_entries() and not self._showed_first_time_guide:
    guide_dialog = StepByStepGuideDialog(self)
    if guide_dialog.exec() == QDialog.DialogCode.Accepted:
        # User finished the guide, now proceed with adding
        self._showed_first_time_guide = True  # ← Nou: marcar que la guia s'ha mostrat
    else:
        # User cancelled the guide
        return
```

#### 4. Actualitzat `_on_delete_all_data()`:
```python
self._showed_first_time_guide = False  # ← Nou: resetejar quan es borren les dades
```

### `src/ui/tutorial_dialog.py`

Ja existent amb les classes:
- `FirstTimeGuideDialog`: Guia bàsica
- `StepByStepGuideDialog`: Guia detallada amb diagrama de flux

## 🔄 Flux Correcte Ara

```
┌─────────────────────────────────────────────────┐
│  1. L'usuari executa python main.py             │
│     ↓                                            │
│  2. Crea una nova caixa forta                   │
│     ↓                                            │
│  3. Introdueix la contrasenya mestra            │
│     ↓                                            │
│  4. La guia visual amb fletxes s'obre           │
│     ↓                                            │
│  5. L'usuari navega per les fletxes ◀ ▶         │
│     ↓                                            │
│  6. Clica "Finalitzar"                          │
│     ↓                                            │
│  7. Clica "Afegir accés" (NO es mostra la guia) │
│     ↓                                            │
│  8. S'obre el diàleg d'afegir                   │
│     ↓                                            │
│  9. L'usuari omple les dades                    │
│     ↓                                            │
│ 10. La entrada es guarda                        │
└─────────────────────────────────────────────────┘
```

## ✅ Resultat

Ara l'experiència de l'usuari és:
1. ✅ La guia visual amb fletxes **sí que apareix**
2. ✅ No cal reintroduir la contrasenya
3. ✅ La guia només es mostra **una vegada**
4. ✅ Si esborren totes les dades i comencen de nou, la guia es mostra de nou

## 🧪 Com Provar-ho

```bash
# 1. Executa l'aplicació
python3 main.py

# 2. Crea una nova caixa forta amb una contrasenya segura
# 3. La guia visual amb fletxes s'ha d'obrir automàticament
# 4. Navega per les fletxes i finalitza
# 5. Clica "Afegir accés" - la guia NO hauria de mostrar-se de nou
# 6. Omple el primer accés (Google, Instagram, etc.)
# 7. Guarda les dades
```
