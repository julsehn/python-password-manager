# 📋 Guia Pas a Pas: Crear la Primera Entrada

## 🚀 Començar

```
┌─────────────────────────────────────────────────┐
│  1. Obre la terminal i executa:                │
│     python main.py                              │
└─────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────┐
│  2. Escriu: `vault create`                      │
│     (o simplement `vault`)                      │
└─────────────────────────────────────────────────┘
```

---

## ✨ Crear una Nova Entrada

```
┌─────────────────────────────────────────────────┐
│  3. L'aplicació et demanarà:                    │
│     "Nom de la entrada:"                        │
│                                                  │
│  📝 Exemple:                                    │
│     Google                                      │
│     Facebook                                    │
│     Spotify                                     │
└─────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────┐
│  4. Després, escriu:                             │
│     "URL o description:"                        │
│                                                  │
│  📝 Exemple:                                    │
│     https://www.google.com                      │
└─────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────┐
│  5. Ara, escriu la teva contrasenya:            │
│     "Contrasenya:"                              │
│                                                  │
│  🔐 Recomanació:                                │
│     Mínim 12 caràcters                          │
│     Més de 2 tipus diferents                    │
│     Inclou números i símbols                    │
│                                                  │
│  📝 Exemple:                                    │
│     M@rca2024!                                  │
└─────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────┐
│  6. (Opcional) Afegir notes:                    │
│     "Notes (opcional):"                         │
│                                                  │
│  📝 Exemple:                                    │
│     "Recorda canviar la contrasenya cada 6 mesos"│
│                                                  │
│  ⚠️ Si no vols afegir notes, prem Enter         │
└─────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────┐
│  7. (Opcional) Afegir etiqueta:                  │
│     "Etiqueta (opcional):"                      │
│                                                  │
│  📝 Exemple:                                    │
│     "Social Media"                              │
│     "Banking"                                   │
│     "Work"                                      │
│                                                  │
│  ⚠️ Si no vols afegir etiqueta, prem Enter      │
└─────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────┐
│  8. Confirma la entrada:                         │
│     "Vols guardar aquesta entrada?"             │
│                                                  │
│  ✅ Respon: `yes` o `y`                         │
│  ❌ Respon: `no` o `n`                          │
└─────────────────────────────────────────────────┘
```

---

## ✅ Confirmació Final

```
┌─────────────────────────────────────────────────┐
│  9. Veuràs una confirmació:                      │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │ ✅ Entrada creada amb èxit!              │  │
│  │                                          │  │
│  │ Nom: Google                              │  │
│  │ URL: https://www.google.com             │  │
│  │ Etiqueta: (cap)                          │  │
│  │ Data: 2024-01-15 10:30:00               │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────┐
│  10. L'entrada s'ha guardat a:                   │
│     ~/.password_manager/vault.json              │
│                                                  │
│  🔒 La teva dada està encriptada amb AES-256   │
└─────────────────────────────────────────────────┘
```

---

## 🎯 Resum Visual

```
┌─────────────────────────────────────────────────┐
│  ETAPES PRINCIPALS:                              │
│                                                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │  vault  │→ │ vault   │→ │ vault   │         │
│  │ create  │  │ add     │  │ save    │         │
│  └─────────┘  └─────────┘  └─────────┘         │
│                                                  │
│  1. Iniciar aplicació  →  2. Crear entrada     │
│  3. Omplir dades       →  4. Confirmar guarda  │
└─────────────────────────────────────────────────┘
```

---

## 💡 Consells Addicionals

```
┌─────────────────────────────────────────────────┐
│  🔹 Per veure totes les entrades:               │
│     vault list                                  │
│                                                  │
│  🔹 Per buscar una entrada específica:          │
│     vault search "Google"                       │
│                                                  │
│  🔹 Per editar una entrada:                     │
│     vault edit <id>                             │
│                                                  │
│  🔹 Per eliminar una entrada:                   │
│     vault delete <id>                           │
│                                                  │
│  🔹 Per generar una contrasenya segura:         │
│     vault generate                              │
└─────────────────────────────────────────────────┘
```

---

## 🛡️ Seguretat

```
┌─────────────────────────────────────────────────┐
│  ✅ La teva dada està protegida:                │
│                                                  │
│  • Encriptació: AES-256-GCM                    │
│  • Derivació de clau: PBKDF2 (600k iteracions) │
│  • Protecció contra força bruta: 10 intents     │
│  • Bloqueig automàtic: 5 minuts                │
│                                                  │
│  🔒 NINGÚ pot veure les teves dades sense       │
│     la teva contrasenya!                        │
└─────────────────────────────────────────────────┘
```
