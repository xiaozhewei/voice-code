(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TerminalLogic = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    const TerminalLogic = {
        /**
         * Formats a line selected from the terminal.
         * Removes trailing newline characters but preserves other whitespace.
         * @param {string} text The line text to format.
         * @returns {string} The formatted text.
         */
        formatSelectedLine: function (text) {
            if (text === null || text === undefined) {
                return '';
            }
            // Replace trailing \n, \r, or \r\n
            return text.replace(/[\r\n]+$/, '');
        }
    };

    return TerminalLogic;
}));
