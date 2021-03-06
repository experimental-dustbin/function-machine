/// <reference path="combinators.ts" />
/// <reference path="lexer.ts" />
/// <reference path="ast.ts" />

// The grammar that takes the input from the lexer phase. Incidentally the lexer is also just another
// parser combinator grammar.
class G {
  
  // Matches the given word.
  static word(w : string) : Parser {
    return Parser.m(x => x.characters === w);
  }

  // Matches any one of a set of words.
  static word_set(...args : Array<string>) : Parser {
    var parser = args.map(word => G.word(word)).reduce((previous, current) => previous.or(current));
    return parser.transformer(x => x.characters);
  }

  // Comes up often enough so might as well name it.
  static delayed_sexpr : Parser = Parser.delay(x => G.s_expr);

  // Another common operation: ( p )
  static parenthesize(p : Parser) : Parser {
    return G.lparen.then(p).then(G.rparen);
  }

  // Number token.
  static num : Parser = Parser.m(x => x.type === TokenType.NUMBER).transformer(
    (x : Token) : Num => new Num(parseInt(x.characters), {}));

  // Symbol token.
  static symb : Parser = Parser.m(x => x.type === TokenType.SYMBOL).transformer(
    (x : Token) : Symbol => new Symbol(x.characters, {}));

  // Left paren.
  static lparen : Parser = Parser.m(x => x.type === TokenType.LPAREN);

  // Right paren.
  static rparen : Parser = Parser.m(x => x.type === TokenType.RPAREN);

  // (sym sym ... sym).
  static symbol_list : Parser = G.parenthesize(G.symb.many()).transformer((x) : Array<Symbol> => {
    return x[1];
  });

  // (fun (sym sym sym) s-expr).
  static anonymous_func : Parser = G.parenthesize(G.word('fun').then(G.symbol_list).then(
    G.delayed_sexpr)).transformer((x) : AnonymousFunction => {
      var args = x[2];
      var body = x[3];
      return new AnonymousFunction(args, body, {arg_count: args.length});
  });

  // ((fun ...) s-expr*).
  static func_application : Parser = G.parenthesize(G.anonymous_func.then(G.delayed_sexpr.zero_or_more()).then(
    G.rparen)).transformer((x) : FunctionApplication => {
      var func = x[1];
      var args = x[2];
      return new FunctionApplication(func, args, {arg_count: func.attrs.arg_count - args.length});
  });

  // (applied-func s-expr*).
  static closure : Parser = G.parenthesize(G.func_application.then(G.delayed_sexpr.zero_or_more())).transformer((x) : ClosureApplication => {
      var applied_func = x[1];
      var args = x[2];
      return new ClosureApplication(applied_func, args, {arg_count: applied_func.attrs.arg_count - args.length});
  });

  // Current set of builtin functions.
  static builtins : Parser = G.word_set('+', '-', '*', '/', '=', '%', 'lt', 'gt', 'lte', 'gte').transformer((x) : ASTNode => {
    switch(x[0]) {
      case '+':
        return new BuiltinPlus({arity: 2});
      case '-':
        return new BuiltinMinus({arity: 2});
      case '*':
        return new BuiltinTimes({arity: 2});
      case '/':
        return new BuiltinDivide({arity: 2});
      case '=':
        return new BuiltinEqual({arity: 2});
      case '%':
        return new BuiltinModulo({arity: 2});
      case 'lt':
        return new BuiltinLessThan({arity: 2});
      case 'gt':
        return new BuiltinGreaterThan({arity: 2});
      case 'lte':
        return new BuiltinLessThanEqual({arity: 2});
      case 'gte':
        return new BuiltinGreaterThanEqual({arity: 2});
      case 'and':
        return new BuiltinAnd({arity: 2});
      case 'or':
        return new BuiltinOr({arity: 2});
      case 'not':
        return new BuiltinNot({arity: 1});
      case 'xor':
        return new BuiltinXor({arity: 1});
      default:
        throw new Error('Unknown builtin.');
    }
  });


  // We currently single out builtin function application.
  static builtin : Parser = G.parenthesize(G.builtins.then(G.delayed_sexpr.zero_or_more())).transformer((x) : BuiltinApplication => {
    var non_parens = x[1];
    var builtin = non_parens[0];
    var args = non_parens[1];
    return new BuiltinApplication(builtin, args, {});
  });

  // (if s-expr s-expr s-expr).
  static if_expression : Parser = G.parenthesize(G.word('if').then(G.delayed_sexpr).then(
    G.delayed_sexpr).then(G.delayed_sexpr)).transformer((x) : IfExpression => {
        var test = x[2];
        var true_branch = x[3];
        var false_branch = x[4];
        return new IfExpression(test, true_branch, false_branch, {});
  });

  // < Left angle bracket.
  static langle : Parser = Parser.m(x => x.type === TokenType.LANGLE);

  // > Right angle bracket.
  static rangle : Parser = Parser.m(x => x.type === TokenType.RANGLE);

  // [ Left square bracket.
  static lbracket : Parser = Parser.m(x => x.type === TokenType.LBRACKET);

  // ] Right square bracket.
  static rbracket : Parser = Parser.m(x => x.type === TokenType.RBRACKET);

  // Tuple: <s-expr, ..., s-expr>.
  static tuple : Parser = G.langle.then(G.delayed_sexpr).then(G.delayed_sexpr.zero_or_more()).then(
    G.rangle).transformer((x : Array<any>) : Tuple => {
      return new Tuple([x[1]].concat(x[2]), {});
  });

  // TODO: Figure this out. Currently a wildcard.
  static pattern : Parser = Parser.delay(x => G.s_expr);

  // <pattern s-expr>.
  static binding_pair : Parser = G.langle.then(G.pattern).then(G.delayed_sexpr).then(G.rangle).transformer((x) : BindingPair => {
      var variable = x[1];
      var value = x[2];
      return new BindingPair(variable, value, {});
  });

  // (let <var s-expr>* s-expr).
  static let_expression : Parser = G.parenthesize(G.word('let').then(G.binding_pair.many()).then(
    G.delayed_sexpr)).transformer((x) : LetExpressions => {
      var binding_pairs = x[2];
      var body = x[3];
      return new LetExpressions(binding_pairs, body, {});
  });
    
  // List: [s-expr, ..., s-expr].
  static non_empty_data_list : Parser = G.lbracket.then(G.delayed_sexpr).then(G.delayed_sexpr.zero_or_more()).then(
    G.rbracket).transformer((x : Array<any>) : List => {
      return new List([x[1]].concat(x[2]), {});
  });

  // Empty list: [].
  static empty_data_list : Parser = G.lbracket.then(G.rbracket).transformer((x : Array<any>) : List => {
    return new List([], {});
  });

  // Atomic expressions: a bunch of stuff.
  static atomic : Parser = G.non_empty_data_list.or(G.empty_data_list).or(G.tuple).or(G.num).or(
    G.builtin).or(G.anonymous_func).or(G.if_expression).or(G.func_application).or(
      G.let_expression).or(G.closure).or(G.symb);

  // Non-empty list: (atomic s-expr*). This is just here while I work out the syntax.
  static list : Parser = G.parenthesize(G.atomic.then(G.delayed_sexpr.zero_or_more())).transformer((x) : Array<ASTNode> => {
      return [x[1]].concat(x[2]);
  });

  // s-expr: atomic | empty list | non-empty list.
  static s_expr : Parser = G.atomic.or(G.list);

  // Filter out all the ignorable tokens like whitespace and commas and parse the resulting list.
  static parse(input : Array<Token>) : Array<ASTNode> {
    // Filter out all the stuff that is ignorable
    var filtered_tokens : Array<Token> = input.filter(x => !(x.type === TokenType.IGNORE));
    return G.s_expr.many().parse_input(filtered_tokens);
  }

}
