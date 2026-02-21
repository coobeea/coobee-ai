# Final Answers

## Question 1: What is the difference between `let` and `const` in JavaScript?

In JavaScript, `let` and `const` are both used to declare **block-scoped variables**, but they differ in one key aspect:

| Feature          | `let`        | `const`        |
| ---------------- | ------------ | -------------- |
| **Scope**        | Block-scoped | Block-scoped   |
| **Reassignment** | ✅ Allowed   | ❌ Not allowed |
| **Read-only**    | No           | Yes            |

### Key Points:

- **`let`**: Declares a block-scoped variable that **can be reassigned** after its initial declaration.
- **`const`**: Declares a block-scoped variable that creates a **read-only reference** that cannot be reassigned.
- **Both differ from `var`**: Unlike `var` (which is function-scoped), both `let` and `const` are block-scoped.

---

## Question 2: What is the difference between interfaces and types in TypeScript?

In TypeScript, both **interfaces** and **types** can describe object structures, but they have distinct characteristics:

| Feature                  | **Interfaces**       | **Types**                 |
| ------------------------ | -------------------- | ------------------------- |
| **Primary Use**          | Define object shapes | Type aliases for any type |
| **Declaration Merging**  | ✅ Supported         | ❌ Not supported          |
| **Primitives**           | ❌ Cannot represent  | ✅ Can represent          |
| **Unions/Intersections** | Limited              | ✅ Fully supported        |
| **Tuples**               | ❌ Cannot represent  | ✅ Can represent          |

### Key Points:

- **Interfaces**:
  - Primarily used to define **object shapes**
  - Support **declaration merging** (multiple interface declarations with the same name are automatically merged)
  - Better suited for defining **contracts** that may need to be extended or merged across multiple declarations

- **Types**:
  - More **flexible type aliases** that can represent **any type**
  - Can represent primitives, unions, intersections, and tuples
  - Offer **greater versatility** for complex type expressions

---

_Generated on: Saturday, February 21, 2026_
