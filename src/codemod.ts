import type {
  ASTPath,
  CallExpression,
  ExpressionStatement,
  Transform,
} from "jscodeshift";
import picocolors from "picocolors";

const transform: Transform = (file, api, options) => {
  const j = api.jscodeshift;
  const root = j(file.source);

  const usesNextTestUtils = root
    .find(j.ImportDeclaration, {
      source: {
        type: "StringLiteral",
        value: "next-test-utils",
      },
    })
    .some((path) => {
      // Check if the import declaration has a specifier for 'check'.
      const node = path.node;
      node.specifiers ??= [];
      const specifiers = node.specifiers.map((specifier) => {
        return specifier.type === "ImportSpecifier"
          ? specifier.imported.name
          : null;
      });

      return specifiers.includes("check");
    });

  if (!usesNextTestUtils) return;

  let addedRetry = false;

  // Find the 'check' function call and replace it with 'retry'
  root
    .find(j.CallExpression, {
      callee: {
        type: "Identifier",
        name: "check",
      },
      arguments: [
        {
          type: "ArrowFunctionExpression",
        },
      ],
    })
    .forEach((path) => {
      const funcCheckArg = path.node.arguments[0];
      if (funcCheckArg?.type !== "ArrowFunctionExpression") {
        console.log(
          "NOT ARROW",
          picocolors.bgRed(j(path.parentPath).toSource())
        );
        return;
      }

      // Ensure that the body is a block statement.
      if (funcCheckArg.body.type !== "BlockStatement") {
        funcCheckArg.body = j.blockStatement([
          j.returnStatement(funcCheckArg.body),
        ]);
      }

      const nodes = funcCheckArg.body.body;

      // Check if last statement is a return statement with argument 'success'
      const lastStatement = nodes[nodes.length - 1];
      // if (lastStatement?.type !== "ReturnStatement") {
      //   console.log(
      //     "MISSING RETURN",
      //     picocolors.bgRed(j(path.parentPath).toSource())
      //   );
      //   return;
      // }

      const success = path.node.arguments[1];
      if (
        lastStatement?.type === "ReturnStatement" &&
        lastStatement.argument &&
        success
      ) {
        //

        // let successValue: string | RegExp | number | boolean | undefined;
        // if (
        //   success.type === "StringLiteral" ||
        //   success.type === "NumericLiteral" ||
        //   success.type === "RegExpLiteral"
        // ) {
        //   successValue = success.value;
        // } else if (success.type === "Identifier") {
        //   successValue = success.name;
        // }
        // //  else if (success.type === "ObjectExpression") {
        // //   if (success.properties.length !== 1) return;
        // //   if (success.properties[0].type !== "ObjectMethod") return;
        // //   if (success.properties[0].key.type !== "Identifier") return;
        // //   if (success.properties[0].key.name !== "test") return;
        // //   console.log(picocolors.red(j(path.parentPath).toSource()));
        // //   successValue = true;
        // // }
        // else {
        //   console.log(
        //     "UNEXPECTED SUCCESS TYPE",
        //     success.type,
        //     picocolors.red(j(path.parentPath).toSource())
        //   );
        //   return;
        // }

        const foundViolation = j(path)
          .find(j.ReturnStatement, {
            argument: {
              type: "StringLiteral",
            },
          })
          .some((returnPath) => {
            const { argument } = returnPath.node;
            if (!argument) return false;
            if (argument.type !== "StringLiteral") {
              throw new Error("Unexpected argument type: " + argument.type);
            }

            let found = false;
            if (success.type === "RegExpLiteral") {
              found = argument.value !== success.pattern;
            } else if (
              argument.type !== success.type ||
              argument.value !== success.value
            ) {
              found = true;
            }

            if (!found) return false;

            // Try to see if the parent is a conditional expression, if it is, then
            // we can remove the return statement and add an expect statement.
            const parent = returnPath.parent.parentPath.node;

            if (parent.type === "IfStatement") {
              const test = parent.test;
              const consequent = parent.consequent;
              const alternate = parent.alternate;

              if (consequent === returnPath.parent.node) {
                replaceWithComments(
                  returnPath.parent.parentPath,
                  j.expressionStatement(
                    j.memberExpression(
                      j.callExpression(j.identifier("expect"), [test]),
                      j.callExpression(j.identifier("toBeTruthy"), [])
                    )
                  )
                );
              } else if (alternate === returnPath.parent.node) {
                replaceWithComments(
                  returnPath.parent.parentPath,
                  j.expressionStatement(
                    j.memberExpression(
                      j.callExpression(j.identifier("expect"), [test]),
                      j.callExpression(j.identifier("toBeFalsy"), [])
                    )
                  )
                );
              } else {
                console.log("PARENT", parent);
                console.log("NODE", returnPath.node);
              }

              return false;
            }

            return true;
          });

        if (foundViolation) {
          console.log(
            "VIOLATION",
            picocolors.bgRed(j(path.parentPath).toSource())
          );
          return;
        }

        // console.log(picocolors.red(j(path.parentPath).toSource()));

        // if (success.type === "RegExpLiteral") {
        //   console.log("Found RegExpLiteral", success);
        // }

        if (
          "value" in lastStatement.argument &&
          lastStatement.argument.type === success.type &&
          lastStatement.argument.value === success.value
        ) {
          // Remove the last statement.
          nodes.pop();
        } else if (
          success.type === "RegExpLiteral" &&
          lastStatement.argument?.type === "StringLiteral" &&
          success.regex?.pattern === lastStatement.argument.value
        ) {
          nodes.pop();
          // } else if (success.type === "ObjectExpression") {
          //   if (lastStatement.argument?.type === "Identifier") {
          //     console.log("ARG", lastStatement.argument?.type);
          //     nodes.pop();
          //     nodes.push(
          //       j.expressionStatement(
          //         j.memberExpression(
          //           j.callExpression(j.identifier("expect"), [
          //             lastStatement.argument,
          //           ]),
          //           j.callExpression(j.identifier("toBe"), [
          //             j.booleanLiteral(true),
          //             // j.stringLiteral(successValue),
          //           ])
          //         )
          //       )
          //     );
          //   }
        } else if (
          success.type === "NumericLiteral" &&
          lastStatement.argument
        ) {
          nodes.pop();
          nodes.push(
            j.expressionStatement(
              j.memberExpression(
                j.callExpression(j.identifier("expect"), [
                  lastStatement.argument,
                ]),
                j.callExpression(j.identifier("toBe"), [
                  success,
                  // j.stringLiteral(successValue),
                ])
              )
            )
          );
        } else if (
          lastStatement.argument?.type === "ConditionalExpression" &&
          (lastStatement.argument.consequent.type === "StringLiteral" ||
            lastStatement.argument.alternate.type === "StringLiteral")
        ) {
          const test = lastStatement.argument.test;

          // Replace the last statement with an expect against the conditional's
          // test, and check that it's truthy using the 'isTruthy' matcher.
          // So we get expect(test).isTruthy();
          nodes.pop();

          let matcher: "toBeTruthy" | "toBeFalsy";

          if (success.type === "StringLiteral") {
            if (
              lastStatement.argument.consequent.type === "StringLiteral" &&
              lastStatement.argument.consequent.value === success.value
            ) {
              matcher = "toBeTruthy";
            } else {
              matcher = "toBeFalsy";
            }
          } else if (success.type === "RegExpLiteral") {
            if (
              lastStatement.argument.consequent.type === "StringLiteral" &&
              lastStatement.argument.consequent.value === success.pattern
            ) {
              matcher = "toBeTruthy";
            } else {
              matcher = "toBeFalsy";
            }
          } else {
            throw new Error("Unexpected conditional");
          }

          nodes.push(
            j.expressionStatement(
              // j.callExpression(
              j.memberExpression(
                j.callExpression(j.identifier("expect"), [test]),
                j.callExpression(j.identifier(matcher), [])
              )
            )
          );

          //
        } else {
          if (lastStatement.argument?.type !== "AwaitExpression") {
            lastStatement.argument = j.awaitExpression(lastStatement.argument);
          }

          // Ensure that the calling function is async.
          if (!funcCheckArg.async) funcCheckArg.async = true;

          const matcher =
            success.type === "StringLiteral" ? "toEqual" : "toMatch";

          nodes.pop();
          nodes.push(
            j.expressionStatement(
              j.memberExpression(
                j.callExpression(j.identifier("expect"), [
                  lastStatement.argument,
                ]),
                j.callExpression(j.identifier(matcher), [
                  success,
                  // j.stringLiteral(successValue),
                ])
              )
            )
          );
        }

        addedRetry = true;

        // Try to see if there's any async expressions inside the function, if
        // there isn't, then we can remove the async keyword from the function.
        if (funcCheckArg.async) {
          let usesAwait = false;
          j(path)
            .find(j.AwaitExpression)
            .forEach(() => {
              usesAwait = true;
            });

          if (!usesAwait) {
            funcCheckArg.async = false;
          }
        }
      }

      // Let's replace the 'check' function with 'retry'.
      replaceWithComments(
        path,
        j.callExpression(j.identifier("retry"), [funcCheckArg])
      );

      // if (success?.type === "ObjectExpression") {
      //   console.log(picocolors.green(j(path.parentPath).toSource()));
      // }
    });

  // Find the `check` function that just performs a ternary operation that
  // returns a string literal and replace it with a retry with a `retry` call.

  if (addedRetry) {
    // Find the import declaration for 'next-test-utils' and add `check` to it if
    // it isn't already there.

    root
      .find(j.ImportDeclaration, {
        source: {
          type: "StringLiteral",
          value: "next-test-utils",
        },
      })
      .forEach((path) => {
        const node = path.node;
        node.specifiers ??= [];
        const specifiers = node.specifiers.map((specifier) => {
          return specifier.type === "ImportSpecifier"
            ? specifier.imported.name
            : null;
        });

        if (!specifiers.includes("retry")) {
          node.specifiers.push(j.importSpecifier(j.identifier("retry")));
        }

        const usesCheck = root.find(j.CallExpression, {
          callee: {
            type: "Identifier",
            name: "check",
          },
        });

        if (usesCheck.length === 0) {
          node.specifiers = node.specifiers.filter((specifier) => {
            if (specifier.type !== "ImportSpecifier") {
              return true;
            }

            return specifier.imported.name !== "check";
          });
        }
      });
  }

  return root.toSource();
};

function replaceWithComments(
  path: ASTPath,
  newNode: ExpressionStatement | CallExpression
) {
  // If the original node had comments, add them to the new node
  if ("comments" in path.node && path.node.comments) {
    newNode.comments = path.node.comments;
  }

  // Replace the node
  path.replace(newNode);
}

export default transform;
